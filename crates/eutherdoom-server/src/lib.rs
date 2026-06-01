use std::collections::BTreeMap;
use std::time::{Duration, Instant};

pub const MAX_PLAYERS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PlayerId(usize);

impl PlayerId {
    pub fn from_index(index: usize) -> Option<Self> {
        (index < MAX_PLAYERS).then_some(Self(index))
    }

    pub fn index(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerSlot {
    pub id: PlayerId,
    pub name: String,
    pub joined_at: Instant,
    pub last_seen_at: Instant,
    pub ready: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TicCommand {
    pub tic: u32,
    pub forward: i8,
    pub strafe: i8,
    pub turn: i16,
    pub buttons: u16,
    pub weapon: u8,
}

impl TicCommand {
    pub fn neutral(tic: u32) -> Self {
        Self {
            tic,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TicFrame {
    pub tic: u32,
    pub commands: [TicCommand; MAX_PLAYERS],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerSnapshot {
    pub player: usize,
    pub name: String,
    pub ready: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSnapshot {
    pub current_tic: u32,
    pub players: Vec<PlayerSnapshot>,
    pub recent_frames: Vec<TicFrame>,
    pub replay_events: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayEvent {
    Claim {
        player: PlayerId,
        name: String,
    },
    Join {
        player: PlayerId,
        name: String,
    },
    Leave {
        player: PlayerId,
    },
    Ready {
        player: PlayerId,
        ready: bool,
    },
    Command {
        player: PlayerId,
        command: TicCommand,
    },
    Frame(TicFrame),
    Reset,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchError {
    Full,
    InvalidPlayer,
    PlayerNameEmpty,
    SlotOccupied,
    PlayerNotReady,
    CommandTicMismatch { expected: u32, actual: u32 },
    CommandAlreadySubmitted { player: PlayerId, tic: u32 },
}

#[derive(Debug)]
pub struct DoomSession {
    doom_match: DoomMatch,
    replay: Vec<ReplayEvent>,
}

impl DoomSession {
    pub fn new(command_timeout: Duration) -> Self {
        Self {
            doom_match: DoomMatch::new(command_timeout),
            replay: Vec::new(),
        }
    }

    pub fn join(&mut self, name: impl Into<String>, now: Instant) -> Result<PlayerId, MatchError> {
        let name = name.into();
        let player = self.doom_match.join(name.clone(), now)?;
        self.replay.push(ReplayEvent::Join { player, name });
        Ok(player)
    }

    pub fn claim(
        &mut self,
        player: PlayerId,
        name: impl Into<String>,
        now: Instant,
    ) -> Result<(), MatchError> {
        let name = name.into();
        self.doom_match.claim(player, name.clone(), now)?;
        self.replay.push(ReplayEvent::Claim { player, name });
        Ok(())
    }

    pub fn leave(&mut self, player: PlayerId) -> Result<(), MatchError> {
        self.doom_match.leave(player)?;
        self.replay.push(ReplayEvent::Leave { player });
        Ok(())
    }

    pub fn set_ready(
        &mut self,
        player: PlayerId,
        ready: bool,
        now: Instant,
    ) -> Result<(), MatchError> {
        self.doom_match.set_ready(player, ready, now)?;
        self.replay.push(ReplayEvent::Ready { player, ready });
        Ok(())
    }

    pub fn heartbeat(&mut self, player: PlayerId, now: Instant) -> Result<(), MatchError> {
        self.doom_match.heartbeat(player, now)
    }

    pub fn submit_command(
        &mut self,
        player: PlayerId,
        command: TicCommand,
        now: Instant,
    ) -> Result<Vec<TicFrame>, MatchError> {
        let frames = self.doom_match.submit_command(player, command, now)?;
        self.replay.push(ReplayEvent::Command { player, command });
        self.record_frames(&frames);
        Ok(frames)
    }

    pub fn tick(&mut self, now: Instant) -> Vec<TicFrame> {
        let frames = self.doom_match.tick(now);
        self.record_frames(&frames);
        frames
    }

    pub fn reset(&mut self, now: Instant) {
        self.doom_match.reset(now);
        self.replay.push(ReplayEvent::Reset);
    }

    pub fn current_tic(&self) -> u32 {
        self.doom_match.current_tic()
    }

    pub fn players(&self) -> impl Iterator<Item = &PlayerSlot> {
        self.doom_match.players()
    }

    pub fn completed_frames(&self) -> &[TicFrame] {
        self.doom_match.completed_frames()
    }

    pub fn replay_events(&self) -> &[ReplayEvent] {
        &self.replay
    }

    pub fn snapshot(&self, recent_frame_limit: usize) -> SessionSnapshot {
        let recent_frames = self
            .completed_frames()
            .iter()
            .rev()
            .take(recent_frame_limit)
            .rev()
            .cloned()
            .collect();
        let players = self
            .players()
            .map(|player| PlayerSnapshot {
                player: player.id.index() + 1,
                name: player.name.clone(),
                ready: player.ready,
            })
            .collect();
        SessionSnapshot {
            current_tic: self.current_tic(),
            players,
            recent_frames,
            replay_events: self.replay.len(),
        }
    }

    pub fn replay_text(&self) -> String {
        self.replay
            .iter()
            .map(format_replay_event)
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn record_frames(&mut self, frames: &[TicFrame]) {
        self.replay
            .extend(frames.iter().cloned().map(ReplayEvent::Frame));
    }
}

#[derive(Debug)]
pub struct DoomMatch {
    players: [Option<PlayerSlot>; MAX_PLAYERS],
    current_tic: u32,
    pending: BTreeMap<u32, [Option<TicCommand>; MAX_PLAYERS]>,
    completed: Vec<TicFrame>,
    command_timeout: Duration,
}

impl DoomMatch {
    pub fn new(command_timeout: Duration) -> Self {
        Self {
            players: [None, None],
            current_tic: 0,
            pending: BTreeMap::new(),
            completed: Vec::new(),
            command_timeout,
        }
    }

    pub fn join(&mut self, name: impl Into<String>, now: Instant) -> Result<PlayerId, MatchError> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(MatchError::PlayerNameEmpty);
        }

        let index = self
            .players
            .iter()
            .position(Option::is_none)
            .ok_or(MatchError::Full)?;

        let id = PlayerId(index);
        self.players[index] = Some(PlayerSlot {
            id,
            name,
            joined_at: now,
            last_seen_at: now,
            ready: false,
        });
        Ok(id)
    }

    pub fn claim(
        &mut self,
        player: PlayerId,
        name: impl Into<String>,
        now: Instant,
    ) -> Result<(), MatchError> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(MatchError::PlayerNameEmpty);
        }
        let slot = self.slot_mut(player)?;
        if slot.is_some() {
            return Err(MatchError::SlotOccupied);
        }
        *slot = Some(PlayerSlot {
            id: player,
            name,
            joined_at: now,
            last_seen_at: now,
            ready: false,
        });
        Ok(())
    }

    pub fn leave(&mut self, player: PlayerId) -> Result<(), MatchError> {
        let slot = self.slot_mut(player)?;
        *slot = None;

        for commands in self.pending.values_mut() {
            commands[player.index()] = None;
        }

        Ok(())
    }

    pub fn set_ready(
        &mut self,
        player: PlayerId,
        ready: bool,
        now: Instant,
    ) -> Result<(), MatchError> {
        let slot = self.player_mut(player)?;
        slot.ready = ready;
        slot.last_seen_at = now;
        Ok(())
    }

    pub fn heartbeat(&mut self, player: PlayerId, now: Instant) -> Result<(), MatchError> {
        self.player_mut(player)?.last_seen_at = now;
        Ok(())
    }

    pub fn submit_command(
        &mut self,
        player: PlayerId,
        command: TicCommand,
        now: Instant,
    ) -> Result<Vec<TicFrame>, MatchError> {
        if command.tic != self.current_tic {
            return Err(MatchError::CommandTicMismatch {
                expected: self.current_tic,
                actual: command.tic,
            });
        }

        let slot = self.player_mut(player)?;
        if !slot.ready {
            return Err(MatchError::PlayerNotReady);
        }
        slot.last_seen_at = now;

        let commands = self.pending.entry(command.tic).or_insert([None, None]);
        let player_command = &mut commands[player.index()];
        if player_command.is_some() {
            return Err(MatchError::CommandAlreadySubmitted {
                player,
                tic: command.tic,
            });
        }
        *player_command = Some(command);

        Ok(self.complete_ready_frames(now))
    }

    pub fn tick(&mut self, now: Instant) -> Vec<TicFrame> {
        self.complete_ready_frames(now)
    }

    pub fn players(&self) -> impl Iterator<Item = &PlayerSlot> {
        self.players.iter().filter_map(Option::as_ref)
    }

    pub fn current_tic(&self) -> u32 {
        self.current_tic
    }

    pub fn completed_frames(&self) -> &[TicFrame] {
        &self.completed
    }

    pub fn reset(&mut self, now: Instant) {
        self.current_tic = 0;
        self.pending.clear();
        self.completed.clear();
        for slot in self.players.iter_mut().flatten() {
            slot.ready = false;
            slot.last_seen_at = now;
        }
    }

    fn complete_ready_frames(&mut self, now: Instant) -> Vec<TicFrame> {
        let mut frames = Vec::new();

        loop {
            let tic = self.current_tic;
            let Some(commands) = self.pending.get(&tic).copied() else {
                break;
            };

            let timed_out = self.command_timeout_elapsed(&commands, now);
            if commands.iter().any(Option::is_none) && !timed_out {
                break;
            }

            let frame = TicFrame {
                tic,
                commands: [
                    commands[0].unwrap_or_else(|| TicCommand::neutral(tic)),
                    commands[1].unwrap_or_else(|| TicCommand::neutral(tic)),
                ],
            };

            self.pending.remove(&tic);
            self.current_tic = self.current_tic.saturating_add(1);
            self.completed.push(frame.clone());
            frames.push(frame);
        }

        frames
    }

    fn command_timeout_elapsed(
        &self,
        commands: &[Option<TicCommand>; MAX_PLAYERS],
        now: Instant,
    ) -> bool {
        self.players.iter().enumerate().any(|(index, player)| {
            player.as_ref().is_some_and(|slot| {
                slot.ready
                    && commands[index].is_none()
                    && now.duration_since(slot.last_seen_at) >= self.command_timeout
            })
        })
    }

    fn player_mut(&mut self, player: PlayerId) -> Result<&mut PlayerSlot, MatchError> {
        self.slot_mut(player)?
            .as_mut()
            .ok_or(MatchError::InvalidPlayer)
    }

    fn slot_mut(&mut self, player: PlayerId) -> Result<&mut Option<PlayerSlot>, MatchError> {
        self.players
            .get_mut(player.index())
            .ok_or(MatchError::InvalidPlayer)
    }
}

fn format_replay_event(event: &ReplayEvent) -> String {
    match event {
        ReplayEvent::Claim { player, name } => {
            format!("CLAIM {} {}", player.index() + 1, escape_replay_text(name))
        }
        ReplayEvent::Join { player, name } => {
            format!("JOIN {} {}", player.index() + 1, escape_replay_text(name))
        }
        ReplayEvent::Leave { player } => format!("LEAVE {}", player.index() + 1),
        ReplayEvent::Ready { player, ready } => {
            format!("READY {} {}", player.index() + 1, u8::from(*ready))
        }
        ReplayEvent::Command { player, command } => {
            format!("CMD {} {}", player.index() + 1, format_command(*command))
        }
        ReplayEvent::Frame(frame) => {
            format!(
                "FRAME {} P1 {} P2 {}",
                frame.tic,
                format_command(frame.commands[0]),
                format_command(frame.commands[1])
            )
        }
        ReplayEvent::Reset => "RESET".to_string(),
    }
}

fn format_command(command: TicCommand) -> String {
    format!(
        "{} {} {} {} {} {}",
        command.tic, command.forward, command.strafe, command.turn, command.buttons, command.weapon
    )
}

fn escape_replay_text(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\n' | '\r' | '\t' => ' ',
            _ => ch,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(tic: u32, forward: i8) -> TicCommand {
        TicCommand {
            tic,
            forward,
            ..TicCommand::default()
        }
    }

    #[test]
    fn assigns_two_player_slots() {
        let now = Instant::now();
        let mut doom_match = DoomMatch::new(Duration::from_millis(250));

        assert_eq!(doom_match.join("one", now).unwrap().index(), 0);
        assert_eq!(doom_match.join("two", now).unwrap().index(), 1);
        assert_eq!(doom_match.join("three", now), Err(MatchError::Full));
    }

    #[test]
    fn claims_requested_player_slot() {
        let now = Instant::now();
        let mut doom_match = DoomMatch::new(Duration::from_millis(250));
        let p2 = PlayerId::from_index(1).unwrap();

        doom_match.claim(p2, "two", now).unwrap();

        assert_eq!(doom_match.players().next().unwrap().id, p2);
        assert_eq!(
            doom_match.claim(p2, "again", now),
            Err(MatchError::SlotOccupied)
        );
    }

    #[test]
    fn completes_frame_when_both_players_submit_current_tic() {
        let now = Instant::now();
        let mut doom_match = DoomMatch::new(Duration::from_millis(250));
        let p1 = doom_match.join("one", now).unwrap();
        let p2 = doom_match.join("two", now).unwrap();
        doom_match.set_ready(p1, true, now).unwrap();
        doom_match.set_ready(p2, true, now).unwrap();

        assert!(
            doom_match
                .submit_command(p1, command(0, 10), now)
                .unwrap()
                .is_empty()
        );
        let frames = doom_match.submit_command(p2, command(0, -4), now).unwrap();

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].tic, 0);
        assert_eq!(frames[0].commands[0].forward, 10);
        assert_eq!(frames[0].commands[1].forward, -4);
        assert_eq!(doom_match.current_tic(), 1);
    }

    #[test]
    fn rejects_future_tic_until_current_frame_is_complete() {
        let now = Instant::now();
        let mut doom_match = DoomMatch::new(Duration::from_millis(250));
        let player = doom_match.join("one", now).unwrap();
        doom_match.set_ready(player, true, now).unwrap();

        assert_eq!(
            doom_match.submit_command(player, command(1, 10), now),
            Err(MatchError::CommandTicMismatch {
                expected: 0,
                actual: 1
            })
        );
    }

    #[test]
    fn timeout_fills_missing_ready_player_with_neutral_command() {
        let now = Instant::now();
        let mut doom_match = DoomMatch::new(Duration::from_millis(250));
        let p1 = doom_match.join("one", now).unwrap();
        let p2 = doom_match.join("two", now).unwrap();
        doom_match.set_ready(p1, true, now).unwrap();
        doom_match.set_ready(p2, true, now).unwrap();

        doom_match.submit_command(p1, command(0, 10), now).unwrap();
        let frames = doom_match.tick(now + Duration::from_millis(251));

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].commands[0].forward, 10);
        assert_eq!(frames[0].commands[1], TicCommand::neutral(0));
    }

    #[test]
    fn reset_keeps_players_and_clears_match_progress() {
        let now = Instant::now();
        let mut doom_match = DoomMatch::new(Duration::from_millis(250));
        let p1 = doom_match.join("one", now).unwrap();
        let p2 = doom_match.join("two", now).unwrap();
        doom_match.set_ready(p1, true, now).unwrap();
        doom_match.set_ready(p2, true, now).unwrap();
        doom_match.submit_command(p1, command(0, 10), now).unwrap();
        doom_match.submit_command(p2, command(0, -4), now).unwrap();

        doom_match.reset(now + Duration::from_secs(1));

        assert_eq!(doom_match.current_tic(), 0);
        assert!(doom_match.completed_frames().is_empty());
        assert_eq!(doom_match.players().count(), 2);
        assert!(doom_match.players().all(|player| !player.ready));
    }

    #[test]
    fn session_records_replay_events_and_snapshot() {
        let now = Instant::now();
        let mut session = DoomSession::new(Duration::from_millis(250));
        let p1 = session.join("one", now).unwrap();
        let p2 = session.join("two", now).unwrap();
        session.set_ready(p1, true, now).unwrap();
        session.set_ready(p2, true, now).unwrap();
        session.submit_command(p1, command(0, 10), now).unwrap();
        session.submit_command(p2, command(0, -4), now).unwrap();

        let snapshot = session.snapshot(4);

        assert_eq!(snapshot.current_tic, 1);
        assert_eq!(snapshot.players.len(), 2);
        assert_eq!(snapshot.recent_frames.len(), 1);
        assert!(session.replay_text().contains("FRAME 0 P1 0 10 0 0 0 0 P2 0 -4 0 0 0 0"));
    }
}
