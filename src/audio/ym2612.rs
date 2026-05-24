#![allow(dead_code)]

use std::f64::consts::TAU;

use super::jg_ym2612::Ym2612 as JgYm2612;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum EnvelopeStage {
    Off,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone, Debug)]
struct RenderState {
    registers: [[u8; 0x100]; 2],
    key_mask: [u8; Ym2612::CHANNELS],
    fnum: [u16; Ym2612::CHANNELS],
    block: [u8; Ym2612::CHANNELS],
    pending_fnum_high: [u8; Ym2612::CHANNELS],
    pending_block: [u8; Ym2612::CHANNELS],
    channel_frequency: [f64; Ym2612::CHANNELS],
    operator_fnum: [u16; Ym2612::OPERATORS_TOTAL],
    operator_block: [u8; Ym2612::OPERATORS_TOTAL],
    operator_pending_fnum_high: [u8; Ym2612::OPERATORS_TOTAL],
    operator_pending_block: [u8; Ym2612::OPERATORS_TOTAL],
    operator_frequency: [f64; Ym2612::OPERATORS_TOTAL],
    algorithm: [u8; Ym2612::CHANNELS],
    feedback: [u8; Ym2612::CHANNELS],
    pan_l: [bool; Ym2612::CHANNELS],
    pan_r: [bool; Ym2612::CHANNELS],
    total_level: [u8; Ym2612::OPERATORS_TOTAL],
    multiple_ratio: [f64; Ym2612::OPERATORS_TOTAL],
    attack_rate: [u8; Ym2612::OPERATORS_TOTAL],
    decay_rate: [u8; Ym2612::OPERATORS_TOTAL],
    sustain_rate: [u8; Ym2612::OPERATORS_TOTAL],
    sustain_level: [u8; Ym2612::OPERATORS_TOTAL],
    release_rate: [u8; Ym2612::OPERATORS_TOTAL],
    phase: [f64; Ym2612::OPERATORS_TOTAL],
    envelope: [f64; Ym2612::OPERATORS_TOTAL],
    envelope_stage: [EnvelopeStage; Ym2612::OPERATORS_TOTAL],
    operator_output: [f64; Ym2612::OPERATORS_TOTAL],
    operator_last_output: [f64; Ym2612::OPERATORS_TOTAL],
    dac_enabled: bool,
    dac_sample: f64,
    dac_output: f64,
    timer_a_counter: i64,
    timer_b_counter: i64,
    timer_control: u8,
    timer_a_enabled: bool,
    timer_b_enabled: bool,
    status: u8,
    busy_cycles: i64,
    last_status_read: u8,
    jg: JgYm2612,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct YmWrite {
    pub index: u64,
    pub port: usize,
    pub reg: u8,
    pub value: u8,
    pub cycle: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct Ym2612 {
    pub registers: [[u8; 0x100]; 2],
    pub status: u8,
    pub writes: u64,
    pub write_log: Vec<YmWrite>,
    pub key_on_writes: u64,
    pub key_on_active_writes: u64,
    pub dac_enable_writes: u64,
    pub dac_data_writes: u64,
    pub frame_jg_samples: usize,
    pub frame_jg_peak: f32,
    address: [u8; 2],
    busy_cycles: i64,
    timer_a_latch: u16,
    timer_b_latch: u8,
    timer_a_counter: i64,
    timer_b_counter: i64,
    timer_control: u8,
    timer_a_enabled: bool,
    timer_b_enabled: bool,
    last_status_read: u8,
    key_mask: [u8; Self::CHANNELS],
    fnum: [u16; Self::CHANNELS],
    block: [u8; Self::CHANNELS],
    pending_fnum_high: [u8; Self::CHANNELS],
    pending_block: [u8; Self::CHANNELS],
    channel_frequency: [f64; Self::CHANNELS],
    operator_fnum: [u16; Self::OPERATORS_TOTAL],
    operator_block: [u8; Self::OPERATORS_TOTAL],
    operator_pending_fnum_high: [u8; Self::OPERATORS_TOTAL],
    operator_pending_block: [u8; Self::OPERATORS_TOTAL],
    operator_frequency: [f64; Self::OPERATORS_TOTAL],
    algorithm: [u8; Self::CHANNELS],
    feedback: [u8; Self::CHANNELS],
    pan_l: [bool; Self::CHANNELS],
    pan_r: [bool; Self::CHANNELS],
    total_level: [u8; Self::OPERATORS_TOTAL],
    multiple_ratio: [f64; Self::OPERATORS_TOTAL],
    attack_rate: [u8; Self::OPERATORS_TOTAL],
    decay_rate: [u8; Self::OPERATORS_TOTAL],
    sustain_rate: [u8; Self::OPERATORS_TOTAL],
    sustain_level: [u8; Self::OPERATORS_TOTAL],
    release_rate: [u8; Self::OPERATORS_TOTAL],
    phase: [f64; Self::OPERATORS_TOTAL],
    envelope: [f64; Self::OPERATORS_TOTAL],
    envelope_stage: [EnvelopeStage; Self::OPERATORS_TOTAL],
    operator_output: [f64; Self::OPERATORS_TOTAL],
    operator_last_output: [f64; Self::OPERATORS_TOTAL],
    dac_enabled: bool,
    dac_sample: f64,
    dac_output: f64,
    last_sync_cycle: u64,
    frame_start_state: RenderState,
    frame_writes: Vec<(u64, usize, u8, u8)>,
    jg: JgYm2612,
    jg_cycle_remainder: u64,
    jg_frame_samples: Vec<f32>,
    jg_frame_stereo_samples: Vec<[f32; 2]>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ym2612Snapshot {
    registers: Vec<Vec<u8>>,
    pub status: u8,
    pub writes: u64,
    pub write_log: Vec<YmWrite>,
    address: [u8; 2],
    busy_cycles: i64,
    timer_a_latch: u16,
    timer_b_latch: u8,
    timer_a_counter: i64,
    timer_b_counter: i64,
    timer_control: u8,
    timer_a_enabled: bool,
    timer_b_enabled: bool,
    last_status_read: u8,
    key_mask: [u8; Ym2612::CHANNELS],
    fnum: [u16; Ym2612::CHANNELS],
    block: [u8; Ym2612::CHANNELS],
    #[serde(default)]
    pending_fnum_high: [u8; Ym2612::CHANNELS],
    #[serde(default)]
    pending_block: [u8; Ym2612::CHANNELS],
    channel_frequency: [f64; Ym2612::CHANNELS],
    operator_fnum: [u16; Ym2612::OPERATORS_TOTAL],
    operator_block: [u8; Ym2612::OPERATORS_TOTAL],
    #[serde(default)]
    operator_pending_fnum_high: [u8; Ym2612::OPERATORS_TOTAL],
    #[serde(default)]
    operator_pending_block: [u8; Ym2612::OPERATORS_TOTAL],
    operator_frequency: [f64; Ym2612::OPERATORS_TOTAL],
    algorithm: [u8; Ym2612::CHANNELS],
    feedback: [u8; Ym2612::CHANNELS],
    pan_l: [bool; Ym2612::CHANNELS],
    pan_r: [bool; Ym2612::CHANNELS],
    total_level: [u8; Ym2612::OPERATORS_TOTAL],
    multiple_ratio: [f64; Ym2612::OPERATORS_TOTAL],
    attack_rate: [u8; Ym2612::OPERATORS_TOTAL],
    decay_rate: [u8; Ym2612::OPERATORS_TOTAL],
    sustain_rate: [u8; Ym2612::OPERATORS_TOTAL],
    sustain_level: [u8; Ym2612::OPERATORS_TOTAL],
    release_rate: [u8; Ym2612::OPERATORS_TOTAL],
    phase: [f64; Ym2612::OPERATORS_TOTAL],
    envelope: [f64; Ym2612::OPERATORS_TOTAL],
    envelope_stage: [EnvelopeStage; Ym2612::OPERATORS_TOTAL],
    operator_output: [f64; Ym2612::OPERATORS_TOTAL],
    operator_last_output: [f64; Ym2612::OPERATORS_TOTAL],
    dac_enabled: bool,
    dac_sample: f64,
    dac_output: f64,
    last_sync_cycle: u64,
    frame_start_state: RenderStateSnapshot,
    frame_writes: Vec<(u64, usize, u8, u8)>,
    #[serde(default)]
    jg: JgYm2612,
    #[serde(default)]
    jg_cycle_remainder: u64,
    #[serde(default)]
    jg_frame_samples: Vec<f32>,
    #[serde(default)]
    jg_frame_stereo_samples: Vec<[f32; 2]>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RenderStateSnapshot {
    registers: Vec<Vec<u8>>,
    key_mask: [u8; Ym2612::CHANNELS],
    fnum: [u16; Ym2612::CHANNELS],
    block: [u8; Ym2612::CHANNELS],
    #[serde(default)]
    pending_fnum_high: [u8; Ym2612::CHANNELS],
    #[serde(default)]
    pending_block: [u8; Ym2612::CHANNELS],
    channel_frequency: [f64; Ym2612::CHANNELS],
    operator_fnum: [u16; Ym2612::OPERATORS_TOTAL],
    operator_block: [u8; Ym2612::OPERATORS_TOTAL],
    #[serde(default)]
    operator_pending_fnum_high: [u8; Ym2612::OPERATORS_TOTAL],
    #[serde(default)]
    operator_pending_block: [u8; Ym2612::OPERATORS_TOTAL],
    operator_frequency: [f64; Ym2612::OPERATORS_TOTAL],
    algorithm: [u8; Ym2612::CHANNELS],
    feedback: [u8; Ym2612::CHANNELS],
    pan_l: [bool; Ym2612::CHANNELS],
    pan_r: [bool; Ym2612::CHANNELS],
    total_level: [u8; Ym2612::OPERATORS_TOTAL],
    multiple_ratio: [f64; Ym2612::OPERATORS_TOTAL],
    attack_rate: [u8; Ym2612::OPERATORS_TOTAL],
    decay_rate: [u8; Ym2612::OPERATORS_TOTAL],
    sustain_rate: [u8; Ym2612::OPERATORS_TOTAL],
    sustain_level: [u8; Ym2612::OPERATORS_TOTAL],
    release_rate: [u8; Ym2612::OPERATORS_TOTAL],
    phase: [f64; Ym2612::OPERATORS_TOTAL],
    envelope: [f64; Ym2612::OPERATORS_TOTAL],
    envelope_stage: [EnvelopeStage; Ym2612::OPERATORS_TOTAL],
    operator_output: [f64; Ym2612::OPERATORS_TOTAL],
    operator_last_output: [f64; Ym2612::OPERATORS_TOTAL],
    dac_enabled: bool,
    dac_sample: f64,
    dac_output: f64,
    timer_a_counter: i64,
    timer_b_counter: i64,
    timer_control: u8,
    timer_a_enabled: bool,
    timer_b_enabled: bool,
    status: u8,
    busy_cycles: i64,
    last_status_read: u8,
    #[serde(default)]
    jg: JgYm2612,
}

impl Default for Ym2612 {
    fn default() -> Self {
        Self::new()
    }
}

impl Ym2612 {
    pub const CLOCK: f64 = 7_670_454.0;
    pub const CHANNELS: usize = 6;
    pub const OPERATORS: usize = 4;
    pub const OPERATORS_TOTAL: usize = Self::CHANNELS * Self::OPERATORS;
    pub const SAMPLE_RATE: usize = 44_100;
    pub const WRITE_BUSY_CYCLES: i64 = 192;
    pub const TIMER_TICK_CYCLES: i64 = 144;
    pub const INTERNAL_SAMPLE_DIVIDER: i64 = Self::TIMER_TICK_CYCLES;
    pub const INTERNAL_SAMPLE_TICKS: u32 = (Self::INTERNAL_SAMPLE_DIVIDER / 6) as u32;
    const FNUM_HZ_SCALE: f64 = 0.0529819;
    const DAC_GAIN: f64 = 0.85;
    const DAC_SMOOTHING: f64 = 0.38;
    const MODULATION_DEPTH: f64 = 32.0;
    const MULTIPLE_RATIOS: [f64; 16] = [
        0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 10.0, 12.0, 12.0, 15.0, 15.0,
    ];

    pub fn new() -> Self {
        let mut ym = Self {
            registers: [[0; 0x100]; 2],
            status: 0,
            writes: 0,
            write_log: Vec::new(),
            key_on_writes: 0,
            key_on_active_writes: 0,
            dac_enable_writes: 0,
            dac_data_writes: 0,
            frame_jg_samples: 0,
            frame_jg_peak: 0.0,
            address: [0; 2],
            busy_cycles: 0,
            timer_a_latch: 0,
            timer_b_latch: 0,
            timer_a_counter: 0,
            timer_b_counter: 0,
            timer_control: 0,
            timer_a_enabled: false,
            timer_b_enabled: false,
            last_status_read: 0,
            key_mask: [0; Self::CHANNELS],
            fnum: [0; Self::CHANNELS],
            block: [0; Self::CHANNELS],
            pending_fnum_high: [0; Self::CHANNELS],
            pending_block: [0; Self::CHANNELS],
            channel_frequency: [0.0; Self::CHANNELS],
            operator_fnum: [0; Self::OPERATORS_TOTAL],
            operator_block: [0; Self::OPERATORS_TOTAL],
            operator_pending_fnum_high: [0; Self::OPERATORS_TOTAL],
            operator_pending_block: [0; Self::OPERATORS_TOTAL],
            operator_frequency: [0.0; Self::OPERATORS_TOTAL],
            algorithm: [0; Self::CHANNELS],
            feedback: [0; Self::CHANNELS],
            pan_l: [true; Self::CHANNELS],
            pan_r: [true; Self::CHANNELS],
            total_level: [127; Self::OPERATORS_TOTAL],
            multiple_ratio: [1.0; Self::OPERATORS_TOTAL],
            attack_rate: [0; Self::OPERATORS_TOTAL],
            decay_rate: [0; Self::OPERATORS_TOTAL],
            sustain_rate: [0; Self::OPERATORS_TOTAL],
            sustain_level: [15; Self::OPERATORS_TOTAL],
            release_rate: [0; Self::OPERATORS_TOTAL],
            phase: [0.0; Self::OPERATORS_TOTAL],
            envelope: [0.0; Self::OPERATORS_TOTAL],
            envelope_stage: [EnvelopeStage::Off; Self::OPERATORS_TOTAL],
            operator_output: [0.0; Self::OPERATORS_TOTAL],
            operator_last_output: [0.0; Self::OPERATORS_TOTAL],
            dac_enabled: false,
            dac_sample: 0.0,
            dac_output: 0.0,
            last_sync_cycle: 0,
            frame_start_state: RenderState::blank(),
            frame_writes: Vec::new(),
            jg: JgYm2612::default(),
            jg_cycle_remainder: 0,
            jg_frame_samples: Vec::new(),
            jg_frame_stereo_samples: Vec::new(),
        };
        ym.reset();
        ym
    }

    pub fn reset(&mut self) {
        self.registers = [[0; 0x100]; 2];
        self.status = 0;
        self.writes = 0;
        self.write_log.clear();
        self.key_on_writes = 0;
        self.key_on_active_writes = 0;
        self.dac_enable_writes = 0;
        self.dac_data_writes = 0;
        self.frame_jg_samples = 0;
        self.frame_jg_peak = 0.0;
        self.address = [0; 2];
        self.busy_cycles = 0;
        self.jg.reset();
        self.jg_cycle_remainder = 0;
        self.jg_frame_samples.clear();
        self.jg_frame_stereo_samples.clear();
        self.timer_a_latch = 0;
        self.timer_b_latch = 0;
        self.timer_a_counter = 0;
        self.timer_b_counter = 0;
        self.timer_control = 0;
        self.timer_a_enabled = false;
        self.timer_b_enabled = false;
        self.last_status_read = 0;
        self.key_mask = [0; Self::CHANNELS];
        self.fnum = [0; Self::CHANNELS];
        self.block = [0; Self::CHANNELS];
        self.pending_fnum_high = [0; Self::CHANNELS];
        self.pending_block = [0; Self::CHANNELS];
        self.channel_frequency = [0.0; Self::CHANNELS];
        self.operator_fnum = [0; Self::OPERATORS_TOTAL];
        self.operator_block = [0; Self::OPERATORS_TOTAL];
        self.operator_pending_fnum_high = [0; Self::OPERATORS_TOTAL];
        self.operator_pending_block = [0; Self::OPERATORS_TOTAL];
        self.operator_frequency = [0.0; Self::OPERATORS_TOTAL];
        self.algorithm = [0; Self::CHANNELS];
        self.feedback = [0; Self::CHANNELS];
        self.pan_l = [true; Self::CHANNELS];
        self.pan_r = [true; Self::CHANNELS];
        self.total_level = [127; Self::OPERATORS_TOTAL];
        self.multiple_ratio = [1.0; Self::OPERATORS_TOTAL];
        self.attack_rate = [0; Self::OPERATORS_TOTAL];
        self.decay_rate = [0; Self::OPERATORS_TOTAL];
        self.sustain_rate = [0; Self::OPERATORS_TOTAL];
        self.sustain_level = [15; Self::OPERATORS_TOTAL];
        self.release_rate = [0; Self::OPERATORS_TOTAL];
        self.phase = [0.0; Self::OPERATORS_TOTAL];
        self.envelope = [0.0; Self::OPERATORS_TOTAL];
        self.envelope_stage = [EnvelopeStage::Off; Self::OPERATORS_TOTAL];
        self.operator_output = [0.0; Self::OPERATORS_TOTAL];
        self.operator_last_output = [0.0; Self::OPERATORS_TOTAL];
        self.dac_enabled = false;
        self.dac_sample = 0.0;
        self.dac_output = 0.0;
        self.last_sync_cycle = 0;
        self.frame_start_state = self.capture_render_state();
        self.frame_writes.clear();
    }

    pub fn snapshot(&self) -> Ym2612Snapshot {
        Ym2612Snapshot {
            registers: registers_to_vec(&self.registers),
            status: self.status,
            writes: self.writes,
            write_log: self.write_log.clone(),
            address: self.address,
            busy_cycles: self.busy_cycles,
            timer_a_latch: self.timer_a_latch,
            timer_b_latch: self.timer_b_latch,
            timer_a_counter: self.timer_a_counter,
            timer_b_counter: self.timer_b_counter,
            timer_control: self.timer_control,
            timer_a_enabled: self.timer_a_enabled,
            timer_b_enabled: self.timer_b_enabled,
            last_status_read: self.last_status_read,
            key_mask: self.key_mask,
            fnum: self.fnum,
            block: self.block,
            pending_fnum_high: self.pending_fnum_high,
            pending_block: self.pending_block,
            channel_frequency: self.channel_frequency,
            operator_fnum: self.operator_fnum,
            operator_block: self.operator_block,
            operator_pending_fnum_high: self.operator_pending_fnum_high,
            operator_pending_block: self.operator_pending_block,
            operator_frequency: self.operator_frequency,
            algorithm: self.algorithm,
            feedback: self.feedback,
            pan_l: self.pan_l,
            pan_r: self.pan_r,
            total_level: self.total_level,
            multiple_ratio: self.multiple_ratio,
            attack_rate: self.attack_rate,
            decay_rate: self.decay_rate,
            sustain_rate: self.sustain_rate,
            sustain_level: self.sustain_level,
            release_rate: self.release_rate,
            phase: self.phase,
            envelope: self.envelope,
            envelope_stage: self.envelope_stage,
            operator_output: self.operator_output,
            operator_last_output: self.operator_last_output,
            dac_enabled: self.dac_enabled,
            dac_sample: self.dac_sample,
            dac_output: self.dac_output,
            last_sync_cycle: self.last_sync_cycle,
            frame_start_state: self.frame_start_state.snapshot(),
            frame_writes: self.frame_writes.clone(),
            jg: self.jg.clone(),
            jg_cycle_remainder: self.jg_cycle_remainder,
            jg_frame_samples: self.jg_frame_samples.clone(),
            jg_frame_stereo_samples: self.jg_frame_stereo_samples.clone(),
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: Ym2612Snapshot) {
        self.registers = registers_from_vec(&snapshot.registers);
        self.status = snapshot.status;
        self.writes = snapshot.writes;
        self.write_log = snapshot.write_log;
        self.address = snapshot.address;
        self.busy_cycles = snapshot.busy_cycles;
        self.timer_a_latch = snapshot.timer_a_latch;
        self.timer_b_latch = snapshot.timer_b_latch;
        self.timer_a_counter = snapshot.timer_a_counter;
        self.timer_b_counter = snapshot.timer_b_counter;
        self.timer_control = snapshot.timer_control;
        self.timer_a_enabled = snapshot.timer_a_enabled;
        self.timer_b_enabled = snapshot.timer_b_enabled;
        self.last_status_read = snapshot.last_status_read;
        self.key_mask = snapshot.key_mask;
        self.fnum = snapshot.fnum;
        self.block = snapshot.block;
        self.pending_fnum_high = snapshot.pending_fnum_high;
        self.pending_block = snapshot.pending_block;
        self.channel_frequency = snapshot.channel_frequency;
        self.operator_fnum = snapshot.operator_fnum;
        self.operator_block = snapshot.operator_block;
        self.operator_pending_fnum_high = snapshot.operator_pending_fnum_high;
        self.operator_pending_block = snapshot.operator_pending_block;
        self.operator_frequency = snapshot.operator_frequency;
        self.algorithm = snapshot.algorithm;
        self.feedback = snapshot.feedback;
        self.pan_l = snapshot.pan_l;
        self.pan_r = snapshot.pan_r;
        self.total_level = snapshot.total_level;
        self.multiple_ratio = snapshot.multiple_ratio;
        self.attack_rate = snapshot.attack_rate;
        self.decay_rate = snapshot.decay_rate;
        self.sustain_rate = snapshot.sustain_rate;
        self.sustain_level = snapshot.sustain_level;
        self.release_rate = snapshot.release_rate;
        self.phase = snapshot.phase;
        self.envelope = snapshot.envelope;
        self.envelope_stage = snapshot.envelope_stage;
        self.operator_output = snapshot.operator_output;
        self.operator_last_output = snapshot.operator_last_output;
        self.dac_enabled = snapshot.dac_enabled;
        self.dac_sample = snapshot.dac_sample;
        self.dac_output = snapshot.dac_output;
        self.last_sync_cycle = snapshot.last_sync_cycle;
        self.frame_start_state = RenderState::from_snapshot(snapshot.frame_start_state);
        self.frame_writes = snapshot.frame_writes;
        self.jg = snapshot.jg;
        self.jg_cycle_remainder = snapshot.jg_cycle_remainder;
        self.jg_frame_samples = snapshot.jg_frame_samples;
        self.jg_frame_stereo_samples = snapshot.jg_frame_stereo_samples;
    }

    pub fn begin_frame(&mut self) {
        self.last_sync_cycle = 0;
        self.frame_start_state = self.capture_render_state();
        self.frame_writes.clear();
        self.jg_frame_samples.clear();
        self.jg_frame_stereo_samples.clear();
        self.frame_jg_samples = 0;
        self.frame_jg_peak = 0.0;
    }

    pub fn sync_to_cycle(&mut self, cycle: u64) {
        if cycle > self.last_sync_cycle {
            self.tick((cycle - self.last_sync_cycle) as i64);
            self.last_sync_cycle = cycle;
        }
    }

    pub fn read_register(&mut self, address: u32) -> u8 {
        let value = self.jg.read_register(address as u16);
        self.last_status_read = value;
        value
    }

    pub fn write_address_1(&mut self, value: u8) {
        self.address[0] = value;
        self.jg.write_address_1(value);
    }

    pub fn write_address_2(&mut self, value: u8) {
        self.address[1] = value;
        self.jg.write_address_2(value);
    }

    pub fn write_data(&mut self, value: u8, port: usize, cycle: Option<u64>) {
        let port = port & 1;
        let reg = self.address[port];
        self.write_register(port, reg, value, cycle, true);
    }

    pub fn write_port(&mut self, offset: u32, value: u8, cycle: Option<u64>) {
        match offset & 0x03 {
            0 => self.write_address_1(value),
            1 => self.write_data(value, 0, cycle),
            2 => self.write_address_2(value),
            _ => self.write_data(value, 1, cycle),
        }
    }

    pub fn write_register(
        &mut self,
        port: usize,
        reg: u8,
        value: u8,
        cycle: Option<u64>,
        log: bool,
    ) {
        let port = port & 1;
        self.registers[port][reg as usize] = value;
        if log {
            self.writes += 1;
            match reg {
                0x28 => {
                    self.key_on_writes += 1;
                    if (value & 0xf0) != 0 {
                        self.key_on_active_writes += 1;
                    }
                }
                0x2a => self.dac_data_writes += 1,
                0x2b => self.dac_enable_writes += 1,
                _ => {}
            }
            self.write_log.push(YmWrite {
                index: self.writes,
                port,
                reg,
                value,
                cycle,
            });
            if self.write_log.len() > 512 {
                self.write_log.remove(0);
            }
            self.frame_writes
                .push((cycle.unwrap_or(0), port, reg, value));
        }
        if self.busy_cycles <= 0 {
            self.busy_cycles = Self::WRITE_BUSY_CYCLES;
        }
        if port == 0 {
            self.jg.write_address_1(reg);
        } else {
            self.jg.write_address_2(reg);
        }
        self.jg.write_data(value);
        self.apply_register(port, reg, value);
    }

    pub fn tick(&mut self, cycles: i64) {
        let cycles = cycles.max(0);
        self.busy_cycles = (self.busy_cycles - cycles).max(0);
        self.tick_timers(cycles);
        self.advance_jg_by_cycles(cycles as u64);
    }

    pub fn irq_asserted(&self) -> bool {
        self.jg.irq_asserted()
    }

    pub fn render_frame_mono_samples(
        &mut self,
        count: usize,
        _frame_cycles: f64,
        _sample_rate: usize,
    ) -> Vec<f32> {
        if count == 0 {
            return Vec::new();
        }

        let mut internal_samples = self.jg_frame_samples.clone();
        if internal_samples.is_empty() {
            let (left, right) = self.jg.sample();
            internal_samples.push(((left + right) * 0.5) as f32);
        }

        resample_linear(&internal_samples, count)
    }

    pub fn render_frame_stereo_samples(
        &mut self,
        count: usize,
        _frame_cycles: f64,
        _sample_rate: usize,
    ) -> Vec<[f32; 2]> {
        if count == 0 {
            return Vec::new();
        }

        let mut internal_samples = if self.jg_frame_stereo_samples.is_empty() {
            self.jg_frame_samples
                .iter()
                .map(|sample| [*sample, *sample])
                .collect::<Vec<_>>()
        } else {
            self.jg_frame_stereo_samples.clone()
        };
        if internal_samples.is_empty() {
            let (left, right) = self.jg.sample();
            internal_samples.push([left as f32, right as f32]);
        }

        resample_linear_stereo(&internal_samples, count)
    }

    pub fn channel_frequency(&self, channel: usize) -> f64 {
        self.channel_frequency[channel]
    }

    fn apply_register(&mut self, port: usize, reg: u8, value: u8) {
        match reg {
            0x24 => self.timer_a_latch = (self.timer_a_latch & 0x0003) | ((value as u16) << 2),
            0x25 => self.timer_a_latch = (self.timer_a_latch & 0x03fc) | (value as u16 & 0x03),
            0x26 => self.timer_b_latch = value,
            0x27 => {
                let old = self.timer_control;
                self.timer_control = value;
                if (value & 0x10) != 0 {
                    self.status &= !0x01;
                }
                if (value & 0x20) != 0 {
                    self.status &= !0x02;
                }
                self.timer_a_enabled = (value & 0x01) != 0;
                self.timer_b_enabled = (value & 0x02) != 0;
                if self.timer_a_enabled && (old & 0x01) == 0 {
                    self.timer_a_counter = self.timer_a_period();
                }
                if self.timer_b_enabled && (old & 0x02) == 0 {
                    self.timer_b_counter = self.timer_b_period();
                }
            }
            0x28 => self.write_key_on(value),
            0x2a => self.dac_sample = ((value as f64 - 0x80 as f64) / 128.0).clamp(-1.0, 1.0),
            0x2b => self.dac_enabled = (value & 0x80) != 0,
            0x30..=0x9f => self.write_operator_register(port, reg, value),
            0xa0..=0xa2 => {
                if let Some(channel) = self.channel_index(port, reg & 0x03) {
                    self.fnum[channel] =
                        value as u16 | ((u16::from(self.pending_fnum_high[channel])) << 8);
                    self.block[channel] = self.pending_block[channel];
                    self.refresh_channel_frequency(channel);
                }
            }
            0xa4..=0xa6 => {
                if let Some(channel) = self.channel_index(port, reg & 0x03) {
                    self.pending_fnum_high[channel] = value & 0x07;
                    self.pending_block[channel] = (value >> 3) & 0x07;
                }
            }
            0xa8..=0xaa => self.write_special_operator_frequency(port, reg, value, false),
            0xac..=0xae => self.write_special_operator_frequency(port, reg, value, true),
            0xb0..=0xb2 => {
                if let Some(channel) = self.channel_index(port, reg & 0x03) {
                    self.algorithm[channel] = value & 0x07;
                    self.feedback[channel] = (value >> 3) & 0x07;
                }
            }
            0xb4..=0xb6 => {
                if let Some(channel) = self.channel_index(port, reg & 0x03) {
                    self.pan_l[channel] = (value & 0x80) != 0;
                    self.pan_r[channel] = (value & 0x40) != 0;
                    if !self.pan_l[channel] && !self.pan_r[channel] {
                        self.pan_l[channel] = true;
                        self.pan_r[channel] = true;
                    }
                }
            }
            _ => {}
        }
    }

    fn write_key_on(&mut self, value: u8) {
        let channel = (value & 0x03) as usize + if (value & 0x04) != 0 { 3 } else { 0 };
        if channel >= Self::CHANNELS {
            return;
        }
        let old = self.key_mask[channel];
        let mask = (value >> 4) & 0x0f;
        self.key_mask[channel] = mask;

        for op in 0..Self::OPERATORS {
            let bit = 1 << op;
            let idx = channel * Self::OPERATORS + op;
            if (mask & bit) != 0 && (old & bit) == 0 {
                self.phase[idx] = 0.0;
                self.operator_output[idx] = 0.0;
                self.operator_last_output[idx] = 0.0;
                self.envelope[idx] = 0.0;
                self.envelope_stage[idx] = EnvelopeStage::Attack;
            } else if (mask & bit) == 0
                && (old & bit) != 0
                && self.envelope_stage[idx] != EnvelopeStage::Off
            {
                self.envelope_stage[idx] = EnvelopeStage::Release;
            }
        }
    }

    fn write_operator_register(&mut self, port: usize, reg: u8, value: u8) {
        let slot = reg & 0x03;
        if slot == 3 {
            return;
        }
        let Some(channel) = self.channel_index(port, slot) else {
            return;
        };
        let op = operator_index(reg);
        let idx = channel * Self::OPERATORS + op;

        match reg & 0xf0 {
            0x30 => self.multiple_ratio[idx] = Self::MULTIPLE_RATIOS[(value & 0x0f) as usize],
            0x40 => self.total_level[idx] = value & 0x7f,
            0x50 => self.attack_rate[idx] = value & 0x1f,
            0x60 => self.decay_rate[idx] = value & 0x1f,
            0x70 => self.sustain_rate[idx] = value & 0x1f,
            0x80 => {
                self.sustain_level[idx] = (value >> 4) & 0x0f;
                self.release_rate[idx] = value & 0x0f;
            }
            _ => {}
        }
    }

    fn write_special_operator_frequency(&mut self, port: usize, reg: u8, value: u8, high: bool) {
        let channel = port * 3 + 2;
        let op = match reg & 0x0f {
            0x08 | 0x0c => 2,
            0x09 | 0x0d => 0,
            _ => 1,
        };
        let idx = channel * Self::OPERATORS + op;
        if high {
            self.operator_pending_fnum_high[idx] = value & 0x07;
            self.operator_pending_block[idx] = (value >> 3) & 0x07;
        } else {
            self.operator_fnum[idx] =
                value as u16 | ((u16::from(self.operator_pending_fnum_high[idx])) << 8);
            self.operator_block[idx] = self.operator_pending_block[idx];
            self.refresh_operator_frequency(idx);
        }
    }

    fn channel_index(&self, port: usize, slot: u8) -> Option<usize> {
        if slot > 2 {
            None
        } else {
            Some((port & 1) * 3 + slot as usize)
        }
    }

    fn advance_jg_by_cycles(&mut self, cycles: u64) {
        if cycles == 0 {
            return;
        }

        let total_cycles = cycles + self.jg_cycle_remainder;
        let mut ticks = total_cycles / 6;
        self.jg_cycle_remainder = total_cycles % 6;

        while ticks > 0 {
            let tick_batch = ticks.min(u32::MAX as u64) as u32;
            self.jg.tick(tick_batch, |(left, right)| {
                let sample = ((left + right) * 0.5) as f32;
                self.frame_jg_peak = self
                    .frame_jg_peak
                    .max(sample.abs())
                    .max((left as f32).abs())
                    .max((right as f32).abs());
                self.jg_frame_samples.push(sample);
                self.jg_frame_stereo_samples
                    .push([left as f32, right as f32]);
            });
            ticks -= u64::from(tick_batch);
        }
        self.frame_jg_samples = self.jg_frame_samples.len();
    }

    fn tick_timers(&mut self, cycles: i64) {
        if self.timer_a_enabled {
            self.timer_a_counter -= cycles;
            while self.timer_a_counter <= 0 {
                if (self.timer_control & 0x04) != 0 {
                    self.status |= 0x01;
                }
                self.timer_a_counter += self.timer_a_period();
            }
        }

        if self.timer_b_enabled {
            self.timer_b_counter -= cycles;
            while self.timer_b_counter <= 0 {
                if (self.timer_control & 0x08) != 0 {
                    self.status |= 0x02;
                }
                self.timer_b_counter += self.timer_b_period();
            }
        }
    }

    fn timer_a_period(&self) -> i64 {
        ((1024 - (self.timer_a_latch & 0x03ff)) as i64 * Self::TIMER_TICK_CYCLES)
            .max(Self::TIMER_TICK_CYCLES)
    }

    fn timer_b_period(&self) -> i64 {
        ((256 - self.timer_b_latch as i64) * 16 * Self::TIMER_TICK_CYCLES)
            .max(16 * Self::TIMER_TICK_CYCLES)
    }

    fn refresh_channel_frequency(&mut self, channel: usize) {
        let fnum = self.fnum[channel];
        self.channel_frequency[channel] = if fnum == 0 {
            0.0
        } else {
            fnum as f64 * 2.0f64.powi(self.block[channel] as i32 - 1) * Self::FNUM_HZ_SCALE
        };
    }

    fn refresh_operator_frequency(&mut self, idx: usize) {
        let fnum = self.operator_fnum[idx];
        self.operator_frequency[idx] = if fnum == 0 {
            0.0
        } else {
            fnum as f64 * 2.0f64.powi(self.operator_block[idx] as i32 - 1) * Self::FNUM_HZ_SCALE
        };
    }

    fn render_sample_mono(&mut self, sample_step: f64) -> f64 {
        let mut mixed = 0.0;

        for channel in 0..Self::CHANNELS {
            let base = channel * Self::OPERATORS;
            let active = self.key_mask[channel] != 0
                || (channel == 5 && self.dac_enabled)
                || (0..Self::OPERATORS).any(|op| {
                    self.envelope[base + op] > 0.0001
                        && self.envelope_stage[base + op] != EnvelopeStage::Off
                });
            if !active {
                continue;
            }

            let sample = if channel == 5 && self.dac_enabled {
                self.render_dac_sample()
            } else {
                self.channel_sample(channel, sample_step)
            };

            if self.pan_l[channel] && self.pan_r[channel] {
                mixed += sample;
            } else if self.pan_l[channel] || self.pan_r[channel] {
                mixed += sample * 0.5;
            }
        }

        (mixed / Self::CHANNELS as f64).clamp(-1.0, 1.0)
    }

    fn channel_sample(&mut self, channel: usize, sample_step: f64) -> f64 {
        let base_frequency = self.channel_frequency[channel];
        if base_frequency <= 0.0 {
            return 0.0;
        }

        let base = channel * Self::OPERATORS;
        let feedback = if self.feedback[channel] > 0 {
            (self.operator_output[base] + self.operator_last_output[base])
                * 2.0f64.powi(self.feedback[channel] as i32 - 7)
        } else {
            0.0
        };

        let op_freq = |this: &Self, op: usize| -> f64 {
            if op == 3 || (this.timer_control & 0xc0) == 0 {
                base_frequency
            } else {
                let idx = base + op;
                if this.operator_frequency[idx] > 0.0 {
                    this.operator_frequency[idx]
                } else {
                    base_frequency
                }
            }
        };

        let sample = match self.algorithm[channel] {
            0 => {
                let o0 = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1_old = self.operator_output[base + 1];
                self.operator_sample(base + 1, op_freq(self, 1), sample_step, o0 * 0.5);
                let o2 =
                    self.operator_sample(base + 2, op_freq(self, 2), sample_step, o1_old * 0.5);
                self.operator_sample(base + 3, base_frequency, sample_step, o2 * 0.5)
            }
            1 => {
                let o0_old = self.operator_output[base];
                self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1_old = self.operator_output[base + 1];
                self.operator_sample(base + 1, op_freq(self, 1), sample_step, 0.0);
                let o2 = self.operator_sample(
                    base + 2,
                    op_freq(self, 2),
                    sample_step,
                    (o0_old + o1_old) * 0.5,
                );
                self.operator_sample(base + 3, base_frequency, sample_step, o2 * 0.5)
            }
            2 => {
                let o0 = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1_old = self.operator_output[base + 1];
                self.operator_sample(base + 1, op_freq(self, 1), sample_step, 0.0);
                let o2 =
                    self.operator_sample(base + 2, op_freq(self, 2), sample_step, o1_old * 0.5);
                self.operator_sample(base + 3, base_frequency, sample_step, (o0 + o2) * 0.5)
            }
            3 => {
                let o0 = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1_old = self.operator_output[base + 1];
                self.operator_sample(base + 1, op_freq(self, 1), sample_step, o0 * 0.5);
                let o2 = self.operator_sample(base + 2, op_freq(self, 2), sample_step, 0.0);
                self.operator_sample(base + 3, base_frequency, sample_step, (o1_old + o2) * 0.5)
            }
            4 => {
                let o0 = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1 = self.operator_sample(base + 1, op_freq(self, 1), sample_step, o0 * 0.5);
                let o2 = self.operator_sample(base + 2, op_freq(self, 2), sample_step, 0.0);
                let o3 = self.operator_sample(base + 3, base_frequency, sample_step, o2 * 0.5);
                (o1 + o3) * 0.5
            }
            5 => {
                let modulator_old = self.operator_output[base];
                let modulator = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1 =
                    self.operator_sample(base + 1, op_freq(self, 1), sample_step, modulator * 0.5);
                let o2 = self.operator_sample(
                    base + 2,
                    op_freq(self, 2),
                    sample_step,
                    modulator_old * 0.5,
                );
                let o3 =
                    self.operator_sample(base + 3, base_frequency, sample_step, modulator * 0.5);
                (o1 + o2 + o3) / 3.0
            }
            6 => {
                let o0 = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1 = self.operator_sample(base + 1, op_freq(self, 1), sample_step, o0 * 0.5);
                let o2 = self.operator_sample(base + 2, op_freq(self, 2), sample_step, 0.0);
                let o3 = self.operator_sample(base + 3, base_frequency, sample_step, 0.0);
                (o1 + o2 + o3) / 3.0
            }
            7 => {
                let o0 = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1 = self.operator_sample(base + 1, op_freq(self, 1), sample_step, 0.0);
                let o2 = self.operator_sample(base + 2, op_freq(self, 2), sample_step, 0.0);
                let o3 = self.operator_sample(base + 3, base_frequency, sample_step, 0.0);
                (o0 + o1 + o2 + o3) * 0.25
            }
            _ => {
                let o0 = self.operator_sample(base, op_freq(self, 0), sample_step, feedback);
                let o1_old = self.operator_output[base + 1];
                self.operator_sample(base + 1, op_freq(self, 1), sample_step, o0 * 0.5);
                let o2 =
                    self.operator_sample(base + 2, op_freq(self, 2), sample_step, o1_old * 0.5);
                self.operator_sample(base + 3, base_frequency, sample_step, o2 * 0.5)
            }
        };

        sample.clamp(-1.0, 1.0)
    }

    fn operator_sample(&mut self, idx: usize, base: f64, sample_step: f64, modulation: f64) -> f64 {
        self.operator_last_output[idx] = self.operator_output[idx];
        self.advance_envelope(idx);
        if self.envelope_stage[idx] == EnvelopeStage::Off && self.envelope[idx] <= 0.0001 {
            self.operator_output[idx] = 0.0;
            return 0.0;
        }

        let mut phase = self.phase[idx] + base * self.multiple_ratio[idx] * sample_step;
        phase -= phase.floor();
        self.phase[idx] = phase;
        let amp = volume_table(self.total_level[idx]) * self.envelope[idx];
        let angle = phase * TAU + modulation * Self::MODULATION_DEPTH;
        self.operator_output[idx] = angle.sin() * amp;
        self.operator_output[idx]
    }

    fn advance_envelope(&mut self, idx: usize) {
        match self.envelope_stage[idx] {
            EnvelopeStage::Attack => {
                let rate = self.attack_rate[idx];
                if rate >= 31 {
                    self.envelope[idx] = 1.0;
                } else if rate > 0 {
                    self.envelope[idx] += (1.0 - self.envelope[idx]) * attack_step(rate);
                }
                if self.envelope[idx] >= 0.995 || rate >= 31 {
                    self.envelope[idx] = 1.0;
                    self.envelope_stage[idx] = EnvelopeStage::Decay;
                }
            }
            EnvelopeStage::Decay => {
                let sustain = sustain_target(self.sustain_level[idx]);
                if self.envelope[idx] > sustain {
                    self.envelope[idx] =
                        (self.envelope[idx] - decay_step(self.decay_rate[idx])).max(sustain);
                } else {
                    self.envelope_stage[idx] = EnvelopeStage::Sustain;
                }
            }
            EnvelopeStage::Sustain => {
                let rate = self.sustain_rate[idx];
                if rate > 0 {
                    self.envelope[idx] = (self.envelope[idx] - decay_step(rate) * 0.35).max(0.0);
                }
            }
            EnvelopeStage::Release => {
                self.envelope[idx] =
                    (self.envelope[idx] - release_step(self.release_rate[idx])).max(0.0);
                if self.envelope[idx] <= 0.0001 {
                    self.envelope_stage[idx] = EnvelopeStage::Off;
                }
            }
            EnvelopeStage::Off => self.envelope[idx] = 0.0,
        }
    }

    fn render_dac_sample(&mut self) -> f64 {
        let target = self.dac_sample * Self::DAC_GAIN;
        self.dac_output += (target - self.dac_output) * Self::DAC_SMOOTHING;
        self.dac_output.clamp(-1.0, 1.0)
    }

    fn capture_render_state(&self) -> RenderState {
        RenderState {
            registers: self.registers,
            key_mask: self.key_mask,
            fnum: self.fnum,
            block: self.block,
            pending_fnum_high: self.pending_fnum_high,
            pending_block: self.pending_block,
            channel_frequency: self.channel_frequency,
            operator_fnum: self.operator_fnum,
            operator_block: self.operator_block,
            operator_pending_fnum_high: self.operator_pending_fnum_high,
            operator_pending_block: self.operator_pending_block,
            operator_frequency: self.operator_frequency,
            algorithm: self.algorithm,
            feedback: self.feedback,
            pan_l: self.pan_l,
            pan_r: self.pan_r,
            total_level: self.total_level,
            multiple_ratio: self.multiple_ratio,
            attack_rate: self.attack_rate,
            decay_rate: self.decay_rate,
            sustain_rate: self.sustain_rate,
            sustain_level: self.sustain_level,
            release_rate: self.release_rate,
            phase: self.phase,
            envelope: self.envelope,
            envelope_stage: self.envelope_stage,
            operator_output: self.operator_output,
            operator_last_output: self.operator_last_output,
            dac_enabled: self.dac_enabled,
            dac_sample: self.dac_sample,
            dac_output: self.dac_output,
            timer_a_counter: self.timer_a_counter,
            timer_b_counter: self.timer_b_counter,
            timer_control: self.timer_control,
            timer_a_enabled: self.timer_a_enabled,
            timer_b_enabled: self.timer_b_enabled,
            status: self.status,
            busy_cycles: self.busy_cycles,
            last_status_read: self.last_status_read,
            jg: self.jg.clone(),
        }
    }

    fn restore_render_state(&mut self, state: &RenderState) {
        self.registers = state.registers;
        self.key_mask = state.key_mask;
        self.fnum = state.fnum;
        self.block = state.block;
        self.pending_fnum_high = state.pending_fnum_high;
        self.pending_block = state.pending_block;
        self.channel_frequency = state.channel_frequency;
        self.operator_fnum = state.operator_fnum;
        self.operator_block = state.operator_block;
        self.operator_pending_fnum_high = state.operator_pending_fnum_high;
        self.operator_pending_block = state.operator_pending_block;
        self.operator_frequency = state.operator_frequency;
        self.algorithm = state.algorithm;
        self.feedback = state.feedback;
        self.pan_l = state.pan_l;
        self.pan_r = state.pan_r;
        self.total_level = state.total_level;
        self.multiple_ratio = state.multiple_ratio;
        self.attack_rate = state.attack_rate;
        self.decay_rate = state.decay_rate;
        self.sustain_rate = state.sustain_rate;
        self.sustain_level = state.sustain_level;
        self.release_rate = state.release_rate;
        self.phase = state.phase;
        self.envelope = state.envelope;
        self.envelope_stage = state.envelope_stage;
        self.operator_output = state.operator_output;
        self.operator_last_output = state.operator_last_output;
        self.dac_enabled = state.dac_enabled;
        self.dac_sample = state.dac_sample;
        self.dac_output = state.dac_output;
        self.timer_a_counter = state.timer_a_counter;
        self.timer_b_counter = state.timer_b_counter;
        self.timer_control = state.timer_control;
        self.timer_a_enabled = state.timer_a_enabled;
        self.timer_b_enabled = state.timer_b_enabled;
        self.status = state.status;
        self.busy_cycles = state.busy_cycles;
        self.last_status_read = state.last_status_read;
        self.jg = state.jg.clone();
    }
}

impl RenderState {
    fn snapshot(&self) -> RenderStateSnapshot {
        RenderStateSnapshot {
            registers: registers_to_vec(&self.registers),
            key_mask: self.key_mask,
            fnum: self.fnum,
            block: self.block,
            pending_fnum_high: self.pending_fnum_high,
            pending_block: self.pending_block,
            channel_frequency: self.channel_frequency,
            operator_fnum: self.operator_fnum,
            operator_block: self.operator_block,
            operator_pending_fnum_high: self.operator_pending_fnum_high,
            operator_pending_block: self.operator_pending_block,
            operator_frequency: self.operator_frequency,
            algorithm: self.algorithm,
            feedback: self.feedback,
            pan_l: self.pan_l,
            pan_r: self.pan_r,
            total_level: self.total_level,
            multiple_ratio: self.multiple_ratio,
            attack_rate: self.attack_rate,
            decay_rate: self.decay_rate,
            sustain_rate: self.sustain_rate,
            sustain_level: self.sustain_level,
            release_rate: self.release_rate,
            phase: self.phase,
            envelope: self.envelope,
            envelope_stage: self.envelope_stage,
            operator_output: self.operator_output,
            operator_last_output: self.operator_last_output,
            dac_enabled: self.dac_enabled,
            dac_sample: self.dac_sample,
            dac_output: self.dac_output,
            timer_a_counter: self.timer_a_counter,
            timer_b_counter: self.timer_b_counter,
            timer_control: self.timer_control,
            timer_a_enabled: self.timer_a_enabled,
            timer_b_enabled: self.timer_b_enabled,
            status: self.status,
            busy_cycles: self.busy_cycles,
            last_status_read: self.last_status_read,
            jg: self.jg.clone(),
        }
    }

    fn from_snapshot(snapshot: RenderStateSnapshot) -> Self {
        Self {
            registers: registers_from_vec(&snapshot.registers),
            key_mask: snapshot.key_mask,
            fnum: snapshot.fnum,
            block: snapshot.block,
            pending_fnum_high: snapshot.pending_fnum_high,
            pending_block: snapshot.pending_block,
            channel_frequency: snapshot.channel_frequency,
            operator_fnum: snapshot.operator_fnum,
            operator_block: snapshot.operator_block,
            operator_pending_fnum_high: snapshot.operator_pending_fnum_high,
            operator_pending_block: snapshot.operator_pending_block,
            operator_frequency: snapshot.operator_frequency,
            algorithm: snapshot.algorithm,
            feedback: snapshot.feedback,
            pan_l: snapshot.pan_l,
            pan_r: snapshot.pan_r,
            total_level: snapshot.total_level,
            multiple_ratio: snapshot.multiple_ratio,
            attack_rate: snapshot.attack_rate,
            decay_rate: snapshot.decay_rate,
            sustain_rate: snapshot.sustain_rate,
            sustain_level: snapshot.sustain_level,
            release_rate: snapshot.release_rate,
            phase: snapshot.phase,
            envelope: snapshot.envelope,
            envelope_stage: snapshot.envelope_stage,
            operator_output: snapshot.operator_output,
            operator_last_output: snapshot.operator_last_output,
            dac_enabled: snapshot.dac_enabled,
            dac_sample: snapshot.dac_sample,
            dac_output: snapshot.dac_output,
            timer_a_counter: snapshot.timer_a_counter,
            timer_b_counter: snapshot.timer_b_counter,
            timer_control: snapshot.timer_control,
            timer_a_enabled: snapshot.timer_a_enabled,
            timer_b_enabled: snapshot.timer_b_enabled,
            status: snapshot.status,
            busy_cycles: snapshot.busy_cycles,
            last_status_read: snapshot.last_status_read,
            jg: snapshot.jg,
        }
    }

    fn blank() -> Self {
        Self {
            registers: [[0; 0x100]; 2],
            key_mask: [0; Ym2612::CHANNELS],
            fnum: [0; Ym2612::CHANNELS],
            block: [0; Ym2612::CHANNELS],
            pending_fnum_high: [0; Ym2612::CHANNELS],
            pending_block: [0; Ym2612::CHANNELS],
            channel_frequency: [0.0; Ym2612::CHANNELS],
            operator_fnum: [0; Ym2612::OPERATORS_TOTAL],
            operator_block: [0; Ym2612::OPERATORS_TOTAL],
            operator_pending_fnum_high: [0; Ym2612::OPERATORS_TOTAL],
            operator_pending_block: [0; Ym2612::OPERATORS_TOTAL],
            operator_frequency: [0.0; Ym2612::OPERATORS_TOTAL],
            algorithm: [0; Ym2612::CHANNELS],
            feedback: [0; Ym2612::CHANNELS],
            pan_l: [true; Ym2612::CHANNELS],
            pan_r: [true; Ym2612::CHANNELS],
            total_level: [127; Ym2612::OPERATORS_TOTAL],
            multiple_ratio: [1.0; Ym2612::OPERATORS_TOTAL],
            attack_rate: [0; Ym2612::OPERATORS_TOTAL],
            decay_rate: [0; Ym2612::OPERATORS_TOTAL],
            sustain_rate: [0; Ym2612::OPERATORS_TOTAL],
            sustain_level: [15; Ym2612::OPERATORS_TOTAL],
            release_rate: [0; Ym2612::OPERATORS_TOTAL],
            phase: [0.0; Ym2612::OPERATORS_TOTAL],
            envelope: [0.0; Ym2612::OPERATORS_TOTAL],
            envelope_stage: [EnvelopeStage::Off; Ym2612::OPERATORS_TOTAL],
            operator_output: [0.0; Ym2612::OPERATORS_TOTAL],
            operator_last_output: [0.0; Ym2612::OPERATORS_TOTAL],
            dac_enabled: false,
            dac_sample: 0.0,
            dac_output: 0.0,
            timer_a_counter: 0,
            timer_b_counter: 0,
            timer_control: 0,
            timer_a_enabled: false,
            timer_b_enabled: false,
            status: 0,
            busy_cycles: 0,
            last_status_read: 0,
            jg: JgYm2612::default(),
        }
    }
}

fn registers_to_vec(registers: &[[u8; 0x100]; 2]) -> Vec<Vec<u8>> {
    registers.iter().map(|page| page.to_vec()).collect()
}

fn registers_from_vec(pages: &[Vec<u8>]) -> [[u8; 0x100]; 2] {
    let mut registers = [[0; 0x100]; 2];
    for (target, source) in registers.iter_mut().zip(pages) {
        for (slot, value) in target.iter_mut().zip(source) {
            *slot = *value;
        }
    }
    registers
}

fn operator_index(reg: u8) -> usize {
    match (reg >> 2) & 0x03 {
        0 => 0,
        1 => 2,
        2 => 1,
        _ => 3,
    }
}

fn advance_jg_to_cycle(
    jg: &mut JgYm2612,
    target_cycle: u64,
    cycle_cursor: &mut u64,
    tick_remainder: &mut u64,
    samples: &mut Vec<f32>,
) {
    if target_cycle <= *cycle_cursor {
        return;
    }

    let elapsed_cycles = target_cycle - *cycle_cursor;
    *cycle_cursor = target_cycle;

    let total_cycles = elapsed_cycles + *tick_remainder;
    let mut ticks = total_cycles / 6;
    *tick_remainder = total_cycles % 6;

    while ticks > 0 {
        let tick_batch = ticks.min(u32::MAX as u64) as u32;
        jg.tick(tick_batch, |(left, right)| {
            samples.push(((left + right) * 0.5) as f32);
        });
        ticks -= u64::from(tick_batch);
    }
}

fn resample_linear(samples: &[f32], output_count: usize) -> Vec<f32> {
    if output_count == 0 {
        return Vec::new();
    }
    if samples.is_empty() {
        return vec![0.0; output_count];
    }
    if samples.len() == 1 {
        return vec![samples[0]; output_count];
    }
    if output_count == 1 {
        return vec![samples[0]];
    }

    let scale = (samples.len() - 1) as f64 / (output_count - 1) as f64;
    (0..output_count)
        .map(|index| {
            let pos = index as f64 * scale;
            let left = pos.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let frac = (pos - left as f64) as f32;
            samples[left] + (samples[right] - samples[left]) * frac
        })
        .collect()
}

fn resample_linear_stereo(samples: &[[f32; 2]], output_count: usize) -> Vec<[f32; 2]> {
    if output_count == 0 {
        return Vec::new();
    }
    if samples.is_empty() {
        return vec![[0.0; 2]; output_count];
    }
    if samples.len() == 1 {
        return vec![samples[0]; output_count];
    }
    if output_count == 1 {
        return vec![samples[0]];
    }

    let scale = (samples.len() - 1) as f64 / (output_count - 1) as f64;
    (0..output_count)
        .map(|index| {
            let pos = index as f64 * scale;
            let left = pos.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let frac = (pos - left as f64) as f32;
            [
                samples[left][0] + (samples[right][0] - samples[left][0]) * frac,
                samples[left][1] + (samples[right][1] - samples[left][1]) * frac,
            ]
        })
        .collect()
}

fn volume_table(level: u8) -> f64 {
    10.0f64.powf(-((level as f64) * 0.75) / 20.0)
}

fn attack_step(rate: u8) -> f64 {
    if rate == 0 {
        0.0
    } else {
        0.00035 * 2.0f64.powf(rate as f64 / 4.0)
    }
}

fn decay_step(rate: u8) -> f64 {
    if rate == 0 {
        0.0
    } else {
        0.000006 * 2.0f64.powf(rate as f64 / 4.0)
    }
}

fn release_step(rate: u8) -> f64 {
    0.00002 * 2.0f64.powf((rate as f64 + 1.0) / 3.0)
}

fn sustain_target(level: u8) -> f64 {
    if level >= 15 {
        0.0
    } else {
        10.0f64.powf(-((level as f64) * 3.0) / 20.0)
    }
}
