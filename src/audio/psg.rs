use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PsgState {
    tone_periods: [u16; Psg::TONE_CHANNELS],
    volumes: [u8; Psg::CHANNELS],
    noise_control: u8,
    noise_reload: Option<u16>,
    latched_channel: usize,
    latched_volume: bool,
    phases: [f64; Psg::TONE_CHANNELS],
    noise_lfsr: u16,
    noise_phase: f64,
    noise_counter_output: f64,
    noise_output: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Psg {
    pub tone_periods: [u16; Self::TONE_CHANNELS],
    pub volumes: [u8; Self::CHANNELS],
    pub noise_control: u8,
    pub writes: u64,
    pub write_log: Vec<PsgWrite>,
    noise_reload: Option<u16>,
    latched_channel: usize,
    latched_volume: bool,
    phases: [f64; Self::TONE_CHANNELS],
    noise_lfsr: u16,
    noise_phase: f64,
    noise_counter_output: f64,
    noise_output: f64,
    frame_start_state: PsgState,
    frame_writes: Vec<(u64, u8)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PsgWrite {
    pub index: u64,
    pub port: Option<u8>,
    pub cycle: Option<u64>,
    pub value: u8,
}

impl Default for Psg {
    fn default() -> Self {
        Self::new()
    }
}

impl Psg {
    pub const CLOCK: f64 = 3_579_545.0;
    pub const SAMPLE_RATE: usize = 44_100;
    pub const PSG_CLOCK: f64 = Self::CLOCK / 16.0;
    pub const TONE_CHANNELS: usize = 3;
    pub const CHANNELS: usize = 4;
    pub const MAX_PERIOD: u16 = 0x03ff;
    const INITIAL_LFSR: u16 = 0x8000;

    pub fn new() -> Self {
        let state = PsgState {
            tone_periods: [Self::MAX_PERIOD; Self::TONE_CHANNELS],
            volumes: [15; Self::CHANNELS],
            noise_control: 0,
            noise_reload: Some(0x10),
            latched_channel: 0,
            latched_volume: false,
            phases: [0.0; Self::TONE_CHANNELS],
            noise_lfsr: Self::INITIAL_LFSR,
            noise_phase: 0.0,
            noise_counter_output: -1.0,
            noise_output: -1.0,
        };

        let mut psg = Self {
            tone_periods: state.tone_periods,
            volumes: state.volumes,
            noise_control: state.noise_control,
            writes: 0,
            write_log: Vec::new(),
            noise_reload: state.noise_reload,
            latched_channel: state.latched_channel,
            latched_volume: state.latched_volume,
            phases: state.phases,
            noise_lfsr: state.noise_lfsr,
            noise_phase: state.noise_phase,
            noise_counter_output: state.noise_counter_output,
            noise_output: state.noise_output,
            frame_start_state: state,
            frame_writes: Vec::new(),
        };
        psg.reset();
        psg
    }

    pub fn reset(&mut self) {
        self.tone_periods = [Self::MAX_PERIOD; Self::TONE_CHANNELS];
        self.volumes = [15; Self::CHANNELS];
        self.noise_control = 0;
        self.noise_reload = Some(0x10);
        self.latched_channel = 0;
        self.latched_volume = false;
        self.writes = 0;
        self.write_log.clear();
        self.phases = [0.0; Self::TONE_CHANNELS];
        self.noise_lfsr = Self::INITIAL_LFSR;
        self.noise_phase = 0.0;
        self.noise_counter_output = -1.0;
        self.noise_output = -1.0;
        self.frame_start_state = self.capture_state();
        self.frame_writes.clear();
    }

    pub fn begin_frame(&mut self) {
        self.frame_start_state = self.capture_state();
        self.frame_writes.clear();
    }

    pub fn write(&mut self, value: u8, port: Option<u8>, cycle: Option<u64>) {
        self.writes += 1;
        self.write_log.push(PsgWrite {
            index: self.writes,
            port,
            cycle,
            value,
        });
        if self.write_log.len() > 512 {
            self.write_log.remove(0);
        }
        self.frame_writes.push((cycle.unwrap_or(0), value));
        self.apply_write(value);
    }

    pub fn apply_write(&mut self, value: u8) {
        if (value & 0x80) != 0 {
            self.latched_channel = ((value >> 5) & 0x03) as usize;
            self.latched_volume = (value & 0x10) != 0;
            let data = value & 0x0f;
            if self.latched_volume {
                self.volumes[self.latched_channel] = data;
            } else if self.latched_channel == 3 {
                self.write_noise_control(data);
            } else {
                self.tone_periods[self.latched_channel] =
                    (self.tone_periods[self.latched_channel] & 0x03f0) | data as u16;
            }
        } else if self.latched_volume {
            self.volumes[self.latched_channel] = value & 0x0f;
        } else if self.latched_channel == 3 {
            self.write_noise_control(value);
        } else {
            self.tone_periods[self.latched_channel] =
                (self.tone_periods[self.latched_channel] & 0x000f) | (((value & 0x3f) as u16) << 4);
        }
    }

    pub fn tone_frequency(&self, channel: usize) -> f64 {
        let period = self.tone_periods[channel].max(1) as f64;
        Self::CLOCK / (32.0 * period)
    }

    pub fn channel_volume(&self, channel: usize) -> f64 {
        volume_table(self.volumes[channel])
    }

    pub fn render_frame_samples(
        &mut self,
        count: usize,
        frame_cycles: f64,
        sample_rate: usize,
    ) -> Vec<f32> {
        let live = self.capture_state();
        self.restore_state(&self.frame_start_state.clone());

        let writes = self.frame_writes.clone();
        let mut write_index = 0;
        let mut cycle_position = 0.0;
        let cycle_step = frame_cycles / count.max(1) as f64;
        let mut samples = vec![0.0; count];

        for sample in samples.iter_mut() {
            let cycle = cycle_position as u64;
            cycle_position += cycle_step;
            while write_index < writes.len() && writes[write_index].0 <= cycle {
                self.apply_write(writes[write_index].1);
                write_index += 1;
            }
            *sample = self.render_sample(sample_rate) as f32;
        }

        let rendered = self.capture_continuity();
        self.restore_state(&live);
        self.phases = rendered.phases;
        self.noise_lfsr = rendered.noise_lfsr;
        self.noise_phase = rendered.noise_phase;
        self.noise_counter_output = rendered.noise_counter_output;
        self.noise_output = rendered.noise_output;

        samples
    }

    fn render_sample(&mut self, sample_rate: usize) -> f64 {
        let sample_rate = sample_rate as f64;
        let mut mixed = 0.0;

        for channel in 0..Self::TONE_CHANNELS {
            let volume = self.channel_volume(channel);
            if volume <= 0.0 {
                continue;
            }

            let frequency = self.tone_frequency(channel);
            if frequency <= 0.0 || frequency >= sample_rate / 2.0 {
                continue;
            }

            self.phases[channel] += frequency / sample_rate;
            while self.phases[channel] >= 1.0 {
                self.phases[channel] -= 1.0;
            }
            mixed += if self.phases[channel] < 0.5 { 0.0 } else { 1.0 } * volume;
        }

        let noise_volume = self.channel_volume(3);
        if noise_volume > 0.0 {
            self.advance_noise(sample_rate);
            mixed += if self.noise_output > 0.0 { 1.0 } else { 0.0 } * noise_volume;
        }

        (mixed / Self::CHANNELS as f64).clamp(-1.0, 1.0)
    }

    fn write_noise_control(&mut self, value: u8) {
        self.noise_control = value & 0x07;
        self.noise_reload = match self.noise_control & 0x03 {
            0 => Some(0x10),
            1 => Some(0x20),
            2 => Some(0x40),
            _ => None,
        };
        self.reset_noise();
    }

    fn reset_noise(&mut self) {
        self.noise_lfsr = Self::INITIAL_LFSR;
        self.noise_phase = 0.0;
        self.noise_counter_output = -1.0;
        self.noise_output = -1.0;
    }

    fn noise_frequency(&self) -> f64 {
        match self.noise_control & 0x03 {
            0 => Self::PSG_CLOCK / (2.0 * 0x10 as f64),
            1 => Self::PSG_CLOCK / (2.0 * 0x20 as f64),
            2 => Self::PSG_CLOCK / (2.0 * 0x40 as f64),
            _ => Self::PSG_CLOCK / (2.0 * self.tone_periods[2].max(1) as f64),
        }
    }

    fn white_noise(&self) -> bool {
        (self.noise_control & 0x04) != 0
    }

    fn advance_noise(&mut self, sample_rate: f64) {
        let frequency = self.noise_frequency();
        if frequency <= 0.0 {
            return;
        }

        self.noise_phase += frequency / sample_rate;
        while self.noise_phase >= 1.0 {
            self.noise_phase -= 1.0;
            self.noise_counter_output = -self.noise_counter_output;
            if self.noise_counter_output <= 0.0 {
                continue;
            }

            self.noise_output = if (self.noise_lfsr & 1) == 0 {
                -1.0
            } else {
                1.0
            };
            let feedback = if self.white_noise() {
                ((self.noise_lfsr & 1) ^ ((self.noise_lfsr >> 3) & 1)) & 1
            } else {
                self.noise_lfsr & 1
            };
            self.noise_lfsr = (self.noise_lfsr >> 1) | (feedback << 15);
        }
    }

    fn capture_state(&self) -> PsgState {
        PsgState {
            tone_periods: self.tone_periods,
            volumes: self.volumes,
            noise_control: self.noise_control,
            noise_reload: self.noise_reload,
            latched_channel: self.latched_channel,
            latched_volume: self.latched_volume,
            phases: self.phases,
            noise_lfsr: self.noise_lfsr,
            noise_phase: self.noise_phase,
            noise_counter_output: self.noise_counter_output,
            noise_output: self.noise_output,
        }
    }

    fn capture_continuity(&self) -> PsgState {
        self.capture_state()
    }

    fn restore_state(&mut self, state: &PsgState) {
        self.tone_periods = state.tone_periods;
        self.volumes = state.volumes;
        self.noise_control = state.noise_control;
        self.noise_reload = state.noise_reload;
        self.latched_channel = state.latched_channel;
        self.latched_volume = state.latched_volume;
        self.phases = state.phases;
        self.noise_lfsr = state.noise_lfsr;
        self.noise_phase = state.noise_phase;
        self.noise_counter_output = state.noise_counter_output;
        self.noise_output = state.noise_output;
    }
}

fn volume_table(level: u8) -> f64 {
    if level >= 15 {
        0.0
    } else {
        10.0f64.powf(-(level as f64) * 2.0 / 20.0)
    }
}
