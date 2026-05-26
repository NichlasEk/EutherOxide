use crate::{MissionProgress, MissionStatus, MissionSummary};

pub const DEFAULT_HIGH_SCORE_LIMIT: usize = 10;
pub const MAX_HIGH_SCORE_NAME_LEN: usize = 16;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HighScoreEntry {
    pub name: String,
    pub score: i32,
    pub cash: i32,
    pub mission: i32,
    pub kills: i32,
    pub targets_destroyed: i32,
    pub objects_collected: i32,
    pub elapsed_ticks: u32,
    pub completed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HighScoreTable {
    limit: usize,
    entries: Vec<HighScoreEntry>,
}

impl Default for HighScoreTable {
    fn default() -> Self {
        Self::new(DEFAULT_HIGH_SCORE_LIMIT)
    }
}

impl HighScoreEntry {
    pub fn new(name: impl Into<String>, mission: i32, summary: MissionSummary) -> Self {
        Self::from_progress(
            name,
            mission,
            summary.progress,
            summary.status == MissionStatus::Won,
        )
    }

    pub fn from_progress(
        name: impl Into<String>,
        mission: i32,
        progress: MissionProgress,
        completed: bool,
    ) -> Self {
        Self {
            name: sanitize_name(name),
            score: progress.score,
            cash: progress.cash,
            mission,
            kills: progress.kills,
            targets_destroyed: progress.targets_destroyed,
            objects_collected: progress.objects_collected,
            elapsed_ticks: progress.elapsed_ticks,
            completed,
        }
    }
}

impl HighScoreTable {
    pub fn new(limit: usize) -> Self {
        Self {
            limit: limit.max(1),
            entries: Vec::new(),
        }
    }

    pub fn entries(&self) -> &[HighScoreEntry] {
        &self.entries
    }

    pub const fn limit(&self) -> usize {
        self.limit
    }

    pub fn qualifies(&self, entry: &HighScoreEntry) -> bool {
        if self.entries.len() < self.limit {
            return true;
        }
        self.entries
            .last()
            .is_some_and(|last| compare_entries(entry, last).is_lt())
    }

    pub fn submit(&mut self, entry: HighScoreEntry) -> bool {
        let qualifies = self.qualifies(&entry);
        if !qualifies {
            return false;
        }
        self.entries.push(entry);
        self.sort_and_truncate();
        true
    }

    pub fn merged(limit: usize, entries: impl IntoIterator<Item = HighScoreEntry>) -> Self {
        let mut table = Self::new(limit);
        for entry in entries {
            table.submit(entry);
        }
        table
    }

    fn sort_and_truncate(&mut self) {
        self.entries.sort_by(compare_entries);
        self.entries.truncate(self.limit);
    }
}

fn sanitize_name(name: impl Into<String>) -> String {
    let trimmed = name.into().trim().to_string();
    let fallback = if trimmed.is_empty() { "ANON".to_string() } else { trimmed };
    fallback.chars().take(MAX_HIGH_SCORE_NAME_LEN).collect()
}

fn compare_entries(a: &HighScoreEntry, b: &HighScoreEntry) -> std::cmp::Ordering {
    b.completed
        .cmp(&a.completed)
        .then_with(|| b.score.cmp(&a.score))
        .then_with(|| b.mission.cmp(&a.mission))
        .then_with(|| b.kills.cmp(&a.kills))
        .then_with(|| b.targets_destroyed.cmp(&a.targets_destroyed))
        .then_with(|| b.objects_collected.cmp(&a.objects_collected))
        .then_with(|| a.elapsed_ticks.cmp(&b.elapsed_ticks))
        .then_with(|| a.name.cmp(&b.name))
}

#[cfg(test)]
mod tests {
    use super::{HighScoreEntry, HighScoreTable, MAX_HIGH_SCORE_NAME_LEN};
    use crate::MissionProgress;

    fn entry(name: &str, score: i32, mission: i32, kills: i32, elapsed_ticks: u32, completed: bool) -> HighScoreEntry {
        HighScoreEntry::from_progress(
            name,
            mission,
            MissionProgress {
                score,
                kills,
                elapsed_ticks,
                ..MissionProgress::default()
            },
            completed,
        )
    }

    #[test]
    fn sorts_by_completion_score_mission_kills_and_time() {
        let mut table = HighScoreTable::new(5);
        table.submit(entry("slow", 1000, 2, 3, 500, true));
        table.submit(entry("fast", 1000, 2, 3, 200, true));
        table.submit(entry("more", 1000, 3, 1, 300, true));
        table.submit(entry("lost", 2000, 9, 9, 100, false));

        let names = table
            .entries()
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["more", "fast", "slow", "lost"]);
    }

    #[test]
    fn truncates_to_limit_and_rejects_non_qualifying_scores() {
        let mut table = HighScoreTable::new(2);
        assert!(table.submit(entry("a", 100, 1, 0, 10, true)));
        assert!(table.submit(entry("b", 200, 1, 0, 10, true)));
        assert!(!table.submit(entry("c", 50, 1, 0, 10, true)));

        assert_eq!(table.entries().len(), 2);
        assert_eq!(table.entries()[0].name, "b");
        assert_eq!(table.entries()[1].name, "a");
    }

    #[test]
    fn sanitizes_empty_and_long_names() {
        assert_eq!(entry("   ", 1, 1, 0, 1, true).name, "ANON");
        assert_eq!(
            entry("abcdefghijklmnopq", 1, 1, 0, 1, true).name.len(),
            MAX_HIGH_SCORE_NAME_LEN
        );
    }
}
