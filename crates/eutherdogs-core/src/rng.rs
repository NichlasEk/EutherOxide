#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Lcg {
    state: u64,
}

impl Lcg {
    pub const fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u32(&mut self) -> u32 {
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.state >> 32) as u32
    }

    pub fn range(&mut self, upper_exclusive: i32) -> i32 {
        debug_assert!(upper_exclusive > 0);
        (self.next_u32() % upper_exclusive as u32) as i32
    }
}
