use eutherdoom_server::{DoomSession, MAX_PLAYERS, MatchError, PlayerId, TicCommand, TicFrame};
use std::env;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_BIND: &str = "127.0.0.1:32666";
const COMMAND_TIMEOUT: Duration = Duration::from_millis(250);

type ClientSender = mpsc::Sender<String>;

#[derive(Debug)]
struct ServerState {
    doom_session: DoomSession,
    clients: [Option<ClientSender>; MAX_PLAYERS],
}

impl ServerState {
    fn new() -> Self {
        Self {
            doom_session: DoomSession::new(COMMAND_TIMEOUT),
            clients: [None, None],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ClientCommand {
    Join(String),
    Ready,
    Heartbeat,
    Cmd(TicCommand),
    Status,
    Help,
    Quit,
}

fn main() -> io::Result<()> {
    let bind_addr = env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_BIND.to_string());
    let listener = TcpListener::bind(&bind_addr)?;
    let state = Arc::new(Mutex::new(ServerState::new()));

    println!("EutherDoom debug server listening on {bind_addr}");
    println!("Connect two clients with: nc {bind_addr}");

    spawn_timeout_pacer(Arc::clone(&state));

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = Arc::clone(&state);
                thread::spawn(move || {
                    if let Err(err) = handle_client(stream, state) {
                        eprintln!("client error: {err}");
                    }
                });
            }
            Err(err) => eprintln!("accept error: {err}"),
        }
    }

    Ok(())
}

fn spawn_timeout_pacer(state: Arc<Mutex<ServerState>>) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(10));
            let mut state = match state.lock() {
                Ok(state) => state,
                Err(_) => return,
            };
            let frames = state.doom_session.tick(Instant::now());
            publish_frames(&mut state, frames);
        }
    });
}

fn handle_client(stream: TcpStream, state: Arc<Mutex<ServerState>>) -> io::Result<()> {
    let peer = stream.peer_addr().ok();
    let writer = stream.try_clone()?;
    let reader = BufReader::new(stream);
    let (tx, rx) = mpsc::channel::<String>();
    let mut player_id = None;

    thread::spawn(move || write_client_loop(writer, rx));

    send_line(&tx, "WELCOME eutherdoom-debug");
    send_line(
        &tx,
        "HELP join <name> | ready | cmd <tic> <forward> <strafe> <turn> <buttons> <weapon>",
    );

    for line in reader.lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match parse_client_command(line) {
            Ok(ClientCommand::Join(name)) => {
                if player_id.is_some() {
                    send_line(&tx, "ERR already joined");
                    continue;
                }

                let result = {
                    let mut state = lock_state(&state)?;
                    match state.doom_session.join(name, Instant::now()) {
                        Ok(id) => {
                            state.clients[id.index()] = Some(tx.clone());
                            Ok(id)
                        }
                        Err(err) => Err(err),
                    }
                };

                match result {
                    Ok(id) => {
                        player_id = Some(id);
                        send_line(&tx, &format!("PLAYER {}", id.index() + 1));
                        broadcast_status(&state);
                    }
                    Err(err) => send_line(&tx, &format!("ERR {}", match_error_text(&err))),
                }
            }
            Ok(ClientCommand::Ready) => match require_player(player_id, &tx) {
                Some(id) => {
                    let result = lock_state(&state)?
                        .doom_session
                        .set_ready(id, true, Instant::now());
                    send_result(&tx, result.map(|()| "READY ok".to_string()));
                    broadcast_status(&state);
                }
                None => continue,
            },
            Ok(ClientCommand::Heartbeat) => match require_player(player_id, &tx) {
                Some(id) => {
                    let result = lock_state(&state)?.doom_session.heartbeat(id, Instant::now());
                    send_result(&tx, result.map(|()| "HEARTBEAT ok".to_string()));
                }
                None => continue,
            },
            Ok(ClientCommand::Cmd(command)) => match require_player(player_id, &tx) {
                Some(id) => {
                    let result = {
                        let mut state = lock_state(&state)?;
                        let result = state.doom_session.submit_command(id, command, Instant::now());
                        if let Ok(frames) = &result {
                            publish_frames(&mut state, frames.clone());
                        }
                        result
                    };
                    if let Err(err) = result {
                        send_line(&tx, &format!("ERR {}", match_error_text(&err)));
                    }
                }
                None => continue,
            },
            Ok(ClientCommand::Status) => send_status(&tx, &state),
            Ok(ClientCommand::Help) => {
                send_line(&tx, "HELP join <name>");
                send_line(&tx, "HELP ready");
                send_line(
                    &tx,
                    "HELP cmd <tic> <forward> <strafe> <turn> <buttons> <weapon>",
                );
                send_line(&tx, "HELP status | heartbeat | quit");
            }
            Ok(ClientCommand::Quit) => break,
            Err(err) => send_line(&tx, &format!("ERR {err}")),
        }
    }

    if let Some(id) = player_id {
        let mut state = lock_state(&state)?;
        let _ = state.doom_session.leave(id);
        state.clients[id.index()] = None;
        publish_line(&state, &format!("LEFT {}", id.index() + 1));
    }

    if let Some(peer) = peer {
        eprintln!("client disconnected: {peer}");
    }

    Ok(())
}

fn write_client_loop(mut writer: TcpStream, rx: mpsc::Receiver<String>) {
    for line in rx {
        if writeln!(writer, "{line}").is_err() {
            break;
        }
        if writer.flush().is_err() {
            break;
        }
    }
}

fn parse_client_command(line: &str) -> Result<ClientCommand, String> {
    let mut parts = line.split_whitespace();
    let Some(command) = parts.next() else {
        return Err("empty command".to_string());
    };

    match command.to_ascii_lowercase().as_str() {
        "join" => {
            let name = parts.collect::<Vec<_>>().join(" ");
            if name.trim().is_empty() {
                return Err("usage: join <name>".to_string());
            }
            Ok(ClientCommand::Join(name))
        }
        "ready" => no_extra(parts, ClientCommand::Ready),
        "heartbeat" | "ping" => no_extra(parts, ClientCommand::Heartbeat),
        "status" => no_extra(parts, ClientCommand::Status),
        "help" => no_extra(parts, ClientCommand::Help),
        "quit" | "exit" => no_extra(parts, ClientCommand::Quit),
        "cmd" => {
            let tic = parse_next(&mut parts, "tic")?;
            let forward = parse_next(&mut parts, "forward")?;
            let strafe = parse_next(&mut parts, "strafe")?;
            let turn = parse_next(&mut parts, "turn")?;
            let buttons = parse_next(&mut parts, "buttons")?;
            let weapon = parse_next(&mut parts, "weapon")?;
            if parts.next().is_some() {
                return Err(
                    "usage: cmd <tic> <forward> <strafe> <turn> <buttons> <weapon>".to_string(),
                );
            }
            Ok(ClientCommand::Cmd(TicCommand {
                tic,
                forward,
                strafe,
                turn,
                buttons,
                weapon,
            }))
        }
        _ => Err("unknown command; try help".to_string()),
    }
}

fn parse_next<T: std::str::FromStr>(
    parts: &mut std::str::SplitWhitespace<'_>,
    name: &str,
) -> Result<T, String> {
    let value = parts
        .next()
        .ok_or_else(|| format!("missing {name}; try help"))?;
    value
        .parse()
        .map_err(|_| format!("invalid {name}: {value}"))
}

fn no_extra(
    mut parts: std::str::SplitWhitespace<'_>,
    command: ClientCommand,
) -> Result<ClientCommand, String> {
    if parts.next().is_some() {
        return Err("too many arguments".to_string());
    }
    Ok(command)
}

fn lock_state(
    state: &Arc<Mutex<ServerState>>,
) -> io::Result<std::sync::MutexGuard<'_, ServerState>> {
    state
        .lock()
        .map_err(|_| io::Error::other("server state lock poisoned"))
}

fn require_player(player_id: Option<PlayerId>, tx: &ClientSender) -> Option<PlayerId> {
    match player_id {
        Some(id) => Some(id),
        None => {
            send_line(tx, "ERR join first");
            None
        }
    }
}

fn send_result(tx: &ClientSender, result: Result<String, MatchError>) {
    match result {
        Ok(line) => send_line(tx, &line),
        Err(err) => send_line(tx, &format!("ERR {}", match_error_text(&err))),
    }
}

fn send_status(tx: &ClientSender, state: &Arc<Mutex<ServerState>>) {
    let state = match lock_state(state) {
        Ok(state) => state,
        Err(err) => {
            send_line(tx, &format!("ERR {err}"));
            return;
        }
    };

    let players = state
        .doom_session
        .players()
        .map(|player| {
            format!(
                "{}:{}:{}",
                player.id.index() + 1,
                player.name,
                if player.ready { "ready" } else { "waiting" }
            )
        })
        .collect::<Vec<_>>()
        .join(",");

    send_line(
        tx,
        &format!(
            "STATUS tic={} players={}",
            state.doom_session.current_tic(),
            if players.is_empty() { "-" } else { &players }
        ),
    );
}

fn broadcast_status(state: &Arc<Mutex<ServerState>>) {
    let state = match lock_state(state) {
        Ok(state) => state,
        Err(err) => {
            eprintln!("status error: {err}");
            return;
        }
    };
    publish_line(
        &state,
        &format!(
            "STATUS tic={} players={}",
            state.doom_session.current_tic(),
            player_count(&state)
        ),
    );
}

fn player_count(state: &ServerState) -> usize {
    state.doom_session.players().count()
}

fn publish_frames(state: &mut ServerState, frames: Vec<TicFrame>) {
    for frame in frames {
        publish_line(state, &format_tic_frame(&frame));
    }
}

fn publish_line(state: &ServerState, line: &str) {
    for tx in state.clients.iter().flatten() {
        send_line(tx, line);
    }
}

fn send_line(tx: &ClientSender, line: &str) {
    let _ = tx.send(line.to_string());
}

fn format_tic_frame(frame: &TicFrame) -> String {
    format!(
        "TIC {} P1 {} P2 {}",
        frame.tic,
        format_command(frame.commands[0]),
        format_command(frame.commands[1])
    )
}

fn format_command(command: TicCommand) -> String {
    format!(
        "{} {} {} {} {}",
        command.forward, command.strafe, command.turn, command.buttons, command.weapon
    )
}

fn match_error_text(err: &MatchError) -> String {
    match err {
        MatchError::Full => "match full".to_string(),
        MatchError::InvalidPlayer => "invalid player".to_string(),
        MatchError::PlayerNameEmpty => "player name is empty".to_string(),
        MatchError::SlotOccupied => "player slot occupied".to_string(),
        MatchError::PlayerNotReady => "player not ready".to_string(),
        MatchError::CommandTicMismatch { expected, actual } => {
            format!("tic mismatch expected={expected} actual={actual}")
        }
        MatchError::CommandAlreadySubmitted { player, tic } => {
            format!("player {} already submitted tic {tic}", player.index() + 1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cmd_line() {
        assert_eq!(
            parse_client_command("cmd 7 10 -2 128 5 3"),
            Ok(ClientCommand::Cmd(TicCommand {
                tic: 7,
                forward: 10,
                strafe: -2,
                turn: 128,
                buttons: 5,
                weapon: 3,
            }))
        );
    }

    #[test]
    fn formats_tic_frame() {
        let frame = TicFrame {
            tic: 2,
            commands: [
                TicCommand {
                    tic: 2,
                    forward: 10,
                    buttons: 1,
                    ..TicCommand::default()
                },
                TicCommand {
                    tic: 2,
                    strafe: -4,
                    weapon: 2,
                    ..TicCommand::default()
                },
            ],
        };

        assert_eq!(
            format_tic_frame(&frame),
            "TIC 2 P1 10 0 0 1 0 P2 0 -4 0 0 2"
        );
    }
}
