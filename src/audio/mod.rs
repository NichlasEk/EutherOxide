pub mod psg;
pub mod ym2612;

pub use psg::Psg;
pub use ym2612::{Ym2612, Ym2612Snapshot};

#[derive(Clone, Debug)]
pub struct Audio {
    pub psg: Psg,
    pub ym2612: Ym2612,
    pub frame_cycles: f64,
    pub ym_frame_cycles: f64,
    psg_filter_state: f64,
    psg_dc_state: f64,
}

impl Default for Audio {
    fn default() -> Self {
        Self::new()
    }
}

impl Audio {
    pub const SAMPLE_RATE: usize = 44_100;
    pub const PSG_GAIN: f64 = 0.28;
    pub const YM_GAIN: f64 = 0.86;
    const PSG_FILTER_ALPHA: f64 = 0.22;
    const PSG_DC_ALPHA: f64 = 0.01;
    const PSG_DC_INTERVAL: usize = 8;

    pub fn new() -> Self {
        Self {
            psg: Psg::new(),
            ym2612: Ym2612::new(),
            frame_cycles: Psg::CLOCK / 60.0,
            ym_frame_cycles: 127_800.0,
            psg_filter_state: 0.0,
            psg_dc_state: 0.0,
        }
    }

    pub fn reset(&mut self) {
        self.psg.reset();
        self.ym2612.reset();
        self.psg_filter_state = 0.0;
        self.psg_dc_state = 0.0;
    }

    pub fn begin_frame(&mut self) {
        self.psg.begin_frame();
        self.ym2612.begin_frame();
    }

    pub fn render_frame_samples(&mut self, count: usize, sample_rate: usize) -> Vec<f32> {
        let mut psg_samples = self
            .psg
            .render_frame_samples(count, self.frame_cycles, sample_rate);
        self.filter_psg_samples(&mut psg_samples);
        let ym_samples =
            self.ym2612
                .render_frame_mono_samples(count, self.ym_frame_cycles, sample_rate);

        for (sample, ym) in psg_samples.iter_mut().zip(ym_samples.iter()) {
            let mixed = (*ym as f64 * Self::YM_GAIN) + (*sample as f64 * Self::PSG_GAIN);
            *sample = mixed.clamp(-1.0, 1.0) as f32;
        }

        psg_samples
    }

    fn filter_psg_samples(&mut self, samples: &mut [f32]) {
        let mut state = self.psg_filter_state;
        let mut dc_state = self.psg_dc_state;

        for (index, sample) in samples.iter_mut().enumerate() {
            let raw = *sample as f64;
            if (index & (Self::PSG_DC_INTERVAL - 1)) == 0 {
                dc_state += (raw - dc_state) * Self::PSG_DC_ALPHA;
            }
            state += ((raw - dc_state) - state) * Self::PSG_FILTER_ALPHA;
            *sample = state as f32;
        }

        self.psg_filter_state = state;
        self.psg_dc_state = dc_state;
    }
}
