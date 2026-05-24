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
    output_filter: GenesisAudioFilter,
}

impl Default for Audio {
    fn default() -> Self {
        Self::new()
    }
}

impl Audio {
    pub const SAMPLE_RATE: usize = 44_100;
    pub const PSG_GAIN: f64 = 0.446_683_592_150_963_15;
    pub const YM_GAIN: f64 = 1.0;

    pub fn new() -> Self {
        Self {
            psg: Psg::new(),
            ym2612: Ym2612::new(),
            frame_cycles: Psg::CLOCK / 60.0,
            ym_frame_cycles: 127_800.0,
            output_filter: GenesisAudioFilter::new(),
        }
    }

    pub fn reset(&mut self) {
        self.psg.reset();
        self.ym2612.reset();
        self.output_filter.reset();
    }

    pub fn begin_frame(&mut self) {
        self.psg.begin_frame();
        self.ym2612.begin_frame();
    }

    pub fn render_frame_samples(&mut self, count: usize, sample_rate: usize) -> Vec<f32> {
        let psg_samples = self
            .psg
            .render_frame_samples(count, self.frame_cycles, sample_rate);
        let ym_samples =
            self.ym2612
                .render_frame_mono_samples(count, self.ym_frame_cycles, sample_rate);

        psg_samples
            .into_iter()
            .zip(ym_samples)
            .map(|(psg, ym)| {
                let psg = self.output_filter.filter_psg(f64::from(psg), sample_rate);
                let ym = self.output_filter.filter_ym(f64::from(ym), sample_rate);
                let mixed = (ym * Self::YM_GAIN) + (psg * Self::PSG_GAIN);
                mixed.clamp(-1.0, 1.0) as f32
            })
            .collect()
    }
}

#[derive(Clone, Debug)]
pub struct GenesisAudioFilter {
    sample_rate: usize,
    psg_high_pass: FirstOrderHighPass,
    psg_low_pass: FirstOrderLowPass,
    ym_high_pass: FirstOrderHighPass,
    ym_low_pass: FirstOrderLowPass,
}

impl Default for GenesisAudioFilter {
    fn default() -> Self {
        Self::new()
    }
}

impl GenesisAudioFilter {
    const DEFAULT_SAMPLE_RATE: usize = 44_100;
    const DC_CUTOFF_HZ: f64 = 5.0;
    const GENESIS_LOW_PASS_CUTOFF_HZ: f64 = 3_390.0;

    pub fn new() -> Self {
        Self::with_sample_rate(Self::DEFAULT_SAMPLE_RATE)
    }

    pub fn with_sample_rate(sample_rate: usize) -> Self {
        let sample_rate = sample_rate.max(1);
        Self {
            sample_rate,
            psg_high_pass: FirstOrderHighPass::new(sample_rate, Self::DC_CUTOFF_HZ),
            psg_low_pass: FirstOrderLowPass::new(sample_rate, Self::GENESIS_LOW_PASS_CUTOFF_HZ),
            ym_high_pass: FirstOrderHighPass::new(sample_rate, Self::DC_CUTOFF_HZ),
            ym_low_pass: FirstOrderLowPass::new(sample_rate, Self::GENESIS_LOW_PASS_CUTOFF_HZ),
        }
    }

    pub fn reset(&mut self) {
        self.psg_high_pass.reset();
        self.psg_low_pass.reset();
        self.ym_high_pass.reset();
        self.ym_low_pass.reset();
    }

    pub fn filter_psg(&mut self, sample: f64, sample_rate: usize) -> f64 {
        self.ensure_sample_rate(sample_rate);
        self.psg_low_pass
            .apply(self.psg_high_pass.apply(sample))
            .clamp(-1.0, 1.0)
    }

    pub fn filter_ym(&mut self, sample: f64, sample_rate: usize) -> f64 {
        self.ensure_sample_rate(sample_rate);
        self.ym_low_pass
            .apply(self.ym_high_pass.apply(sample))
            .clamp(-1.0, 1.0)
    }

    fn ensure_sample_rate(&mut self, sample_rate: usize) {
        let sample_rate = sample_rate.max(1);
        if self.sample_rate != sample_rate {
            *self = Self::with_sample_rate(sample_rate);
        }
    }
}

#[derive(Clone, Debug)]
struct FirstOrderLowPass {
    alpha: f64,
    state: f64,
}

impl FirstOrderLowPass {
    fn new(sample_rate: usize, cutoff_hz: f64) -> Self {
        let dt = 1.0 / sample_rate.max(1) as f64;
        let rc = 1.0 / (2.0 * std::f64::consts::PI * cutoff_hz.max(1.0));
        Self {
            alpha: dt / (rc + dt),
            state: 0.0,
        }
    }

    fn apply(&mut self, sample: f64) -> f64 {
        self.state += self.alpha * (sample - self.state);
        self.state
    }

    fn reset(&mut self) {
        self.state = 0.0;
    }
}

#[derive(Clone, Debug)]
struct FirstOrderHighPass {
    alpha: f64,
    prev_input: f64,
    prev_output: f64,
}

impl FirstOrderHighPass {
    fn new(sample_rate: usize, cutoff_hz: f64) -> Self {
        let dt = 1.0 / sample_rate.max(1) as f64;
        let rc = 1.0 / (2.0 * std::f64::consts::PI * cutoff_hz.max(1.0));
        Self {
            alpha: rc / (rc + dt),
            prev_input: 0.0,
            prev_output: 0.0,
        }
    }

    fn apply(&mut self, sample: f64) -> f64 {
        let output = self.alpha * (self.prev_output + sample - self.prev_input);
        self.prev_input = sample;
        self.prev_output = output;
        output
    }

    fn reset(&mut self) {
        self.prev_input = 0.0;
        self.prev_output = 0.0;
    }
}
