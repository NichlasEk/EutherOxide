use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use euther_oxide::controller::Controller;
use euther_oxide::{Emulator, FrameRun};
use serde::Deserialize;
use wgpu::util::TextureBlitter;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, KeyEvent, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{Key, NamedKey};
use winit::window::{Window, WindowAttributes, WindowId};

const FRAME_WIDTH: u32 = 320;
const FRAME_HEIGHT: u32 = 224;
const CONTROL_ADDR: &str = "127.0.0.1:32162";

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteInput {
    up: bool,
    down: bool,
    left: bool,
    right: bool,
    a: bool,
    b: bool,
    c: bool,
    start: bool,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("euther-oxide-vulkan: {err}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let rom_path = env::args()
        .nth(1)
        .ok_or_else(|| "usage: euther-oxide-vulkan <rom.md|rom.gen|rom.bin>".to_string())?;
    let mut emulator = Emulator::new();
    emulator
        .load_rom_file(&rom_path)
        .map_err(|err| format!("could not load ROM: {err}"))?;

    let remote_input = Arc::new(Mutex::new(RemoteInput::default()));
    start_control_server(remote_input.clone());

    let event_loop = EventLoop::new().map_err(|err| err.to_string())?;
    event_loop.set_control_flow(ControlFlow::Poll);
    let mut app = VulkanApp::new(emulator, remote_input);
    event_loop
        .run_app(&mut app)
        .map_err(|err| format!("event loop failed: {err}"))
}

struct VulkanApp {
    emulator: Emulator,
    remote_input: Arc<Mutex<RemoteInput>>,
    renderer: Option<VulkanRenderer>,
    frame_rgba: Vec<u8>,
    next_frame: Instant,
    last_run: Option<FrameRun>,
}

impl VulkanApp {
    fn new(emulator: Emulator, remote_input: Arc<Mutex<RemoteInput>>) -> Self {
        Self {
            emulator,
            remote_input,
            renderer: None,
            frame_rgba: vec![0; (FRAME_WIDTH * FRAME_HEIGHT * 4) as usize],
            next_frame: Instant::now(),
            last_run: None,
        }
    }

    fn run_emulator_frame(&mut self) {
        self.apply_remote_input();
        self.last_run = Some(self.emulator.run_frame());
        let (width, height) = self.emulator.frame_size();
        if self.frame_rgba.len() != width * height * 4 {
            self.frame_rgba.resize(width * height * 4, 0);
        }
        self.frame_rgba = self.emulator.frame_rgba();
    }

    fn apply_remote_input(&mut self) {
        let input = self
            .remote_input
            .lock()
            .map(|input| *input)
            .unwrap_or_default();
        let pad = &mut self.emulator.bus.controller_a;
        pad.set_pressed(Controller::UP, input.up);
        pad.set_pressed(Controller::DOWN, input.down);
        pad.set_pressed(Controller::LEFT, input.left);
        pad.set_pressed(Controller::RIGHT, input.right);
        pad.set_pressed(Controller::BUTTON_A, input.a);
        pad.set_pressed(Controller::BUTTON_B, input.b);
        pad.set_pressed(Controller::BUTTON_C, input.c);
        pad.set_pressed(Controller::START, input.start);
    }

    fn set_button(&mut self, button: u8, pressed: bool) {
        self.emulator.bus.controller_a.set_pressed(button, pressed);
    }

    fn handle_key(&mut self, event_loop: &ActiveEventLoop, event: &KeyEvent) {
        let pressed = event.state == ElementState::Pressed;
        match event.logical_key.as_ref() {
            Key::Named(NamedKey::Escape) if pressed => event_loop.exit(),
            Key::Named(NamedKey::ArrowUp) => self.set_button(Controller::UP, pressed),
            Key::Named(NamedKey::ArrowDown) => self.set_button(Controller::DOWN, pressed),
            Key::Named(NamedKey::ArrowLeft) => self.set_button(Controller::LEFT, pressed),
            Key::Named(NamedKey::ArrowRight) => self.set_button(Controller::RIGHT, pressed),
            Key::Named(NamedKey::Enter) => self.set_button(Controller::START, pressed),
            Key::Character("z") | Key::Character("Z") => {
                self.set_button(Controller::BUTTON_A, pressed)
            }
            Key::Character("x") | Key::Character("X") => {
                self.set_button(Controller::BUTTON_B, pressed)
            }
            Key::Character("c") | Key::Character("C") => {
                self.set_button(Controller::BUTTON_C, pressed)
            }
            _ => {}
        }
    }
}

fn start_control_server(remote_input: Arc<Mutex<RemoteInput>>) {
    thread::Builder::new()
        .name("euther-oxide-vulkan-control".to_string())
        .spawn(move || {
            let Ok(listener) = TcpListener::bind(CONTROL_ADDR) else {
                eprintln!("vulkan control port {CONTROL_ADDR} is busy; keyboard input still works");
                return;
            };
            for stream in listener.incoming().flatten() {
                handle_control_client(stream, &remote_input);
            }
        })
        .ok();
}

fn handle_control_client(mut stream: TcpStream, remote_input: &Arc<Mutex<RemoteInput>>) {
    let mut request = Vec::new();
    if stream.read_to_end(&mut request).is_err() {
        return;
    }
    let Some(body_start) = request.windows(4).position(|window| window == b"\r\n\r\n") else {
        return;
    };
    let body = &request[body_start + 4..];
    if let Ok(input) = serde_json::from_slice::<RemoteInput>(body) {
        if let Ok(mut state) = remote_input.lock() {
            *state = input;
        }
        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n");
    } else {
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
    }
}

impl ApplicationHandler for VulkanApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.renderer.is_some() {
            return;
        }
        let attrs = WindowAttributes::default()
            .with_title("EutherOxide Vulkan")
            .with_inner_size(LogicalSize::new(960.0, 672.0))
            .with_min_inner_size(LogicalSize::new(320.0, 224.0));
        let window = event_loop
            .create_window(attrs)
            .expect("failed to create Vulkan window");
        self.renderer = Some(pollster::block_on(VulkanRenderer::new(window)));
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(renderer) = &mut self.renderer {
                    renderer.resize(size.width, size.height);
                }
            }
            WindowEvent::KeyboardInput {
                event,
                is_synthetic: false,
                ..
            } => self.handle_key(event_loop, &event),
            WindowEvent::RedrawRequested => {
                let now = Instant::now();
                if now >= self.next_frame {
                    self.run_emulator_frame();
                    let frame_time = Duration::from_secs_f64(1.0 / self.emulator.frame_rate());
                    self.next_frame += frame_time;
                    if self.next_frame < now {
                        self.next_frame = now + frame_time;
                    }
                }
                if let Some(renderer) = &mut self.renderer {
                    renderer.render(&self.frame_rgba);
                    renderer.window.request_redraw();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(renderer) = &self.renderer {
            renderer.window.request_redraw();
        }
    }
}

struct VulkanRenderer {
    window: &'static Window,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    texture: wgpu::Texture,
    texture_view: wgpu::TextureView,
    blitter: TextureBlitter,
}

impl VulkanRenderer {
    async fn new(window: Window) -> Self {
        let window = Box::leak(Box::new(window));
        let size = window.inner_size();
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN,
            ..Default::default()
        });
        let surface = instance
            .create_surface(&*window)
            .expect("failed to create Vulkan surface");
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
            })
            .await
            .expect("no Vulkan adapter found");
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("EutherOxide Vulkan Device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .expect("failed to create Vulkan device");
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .expect("surface is not supported by Vulkan adapter");
        config.present_mode = wgpu::PresentMode::AutoVsync;
        surface.configure(&device, &config);
        let texture = create_frame_texture(&device);
        let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let blitter = TextureBlitter::new(&device, config.format);
        Self {
            window,
            surface,
            device,
            queue,
            config,
            texture,
            texture_view,
            blitter,
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }

    fn render(&mut self, rgba: &[u8]) {
        if rgba.len() == (FRAME_WIDTH * FRAME_HEIGHT * 4) as usize {
            self.queue.write_texture(
                self.texture.as_image_copy(),
                rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(FRAME_WIDTH * 4),
                    rows_per_image: Some(FRAME_HEIGHT),
                },
                wgpu::Extent3d {
                    width: FRAME_WIDTH,
                    height: FRAME_HEIGHT,
                    depth_or_array_layers: 1,
                },
            );
        }

        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return;
            }
            Err(wgpu::SurfaceError::Timeout) => return,
            Err(err) => {
                eprintln!("surface error: {err:?}");
                return;
            }
        };
        let target = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("EutherOxide Vulkan Encoder"),
            });
        self.blitter
            .copy(&self.device, &mut encoder, &self.texture_view, &target);
        self.queue.submit(Some(encoder.finish()));
        frame.present();
    }
}

fn create_frame_texture(device: &wgpu::Device) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("EutherOxide Frame Texture"),
        size: wgpu::Extent3d {
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}
