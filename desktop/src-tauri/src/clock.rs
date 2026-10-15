use std::time::{SystemTime, UNIX_EPOCH};

/// Wall-clock seconds since the Unix epoch. Injectable so throttling, auto-lock and
/// clipboard timers can be tested without waiting.
pub trait Clock: Send + Sync {
    fn now_secs(&self) -> u64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_secs(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }
}

#[cfg(test)]
pub mod fake {
    use super::Clock;
    use std::sync::atomic::{AtomicU64, Ordering};

    pub struct FakeClock(AtomicU64);

    impl FakeClock {
        pub fn new(start: u64) -> Self {
            Self(AtomicU64::new(start))
        }
        pub fn advance(&self, secs: u64) {
            self.0.fetch_add(secs, Ordering::SeqCst);
        }
    }

    impl Clock for FakeClock {
        fn now_secs(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }
}
