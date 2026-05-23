use std::env;
use std::fs::File;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process;

use euther_oxide::Emulator;

fn main() {
    if let Err(err) = run() {
        eprintln!("euther-oxide: {err}");
        process::exit(1);
    }
}

fn run() -> io::Result<()> {
    let mut args = env::args().skip(1);
    let Some(rom_path) = args.next() else {
        print_usage();
        return Ok(());
    };
    if rom_path == "--help" || rom_path == "-h" {
        print_usage();
        return Ok(());
    }

    let mut frames = 1u64;
    let mut dump_path: Option<PathBuf> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--frames" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--frames needs a value",
                    ));
                };
                frames = value.parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, "--frames must be an integer")
                })?;
            }
            "--dump" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--dump needs a path",
                    ));
                };
                dump_path = Some(PathBuf::from(value));
            }
            "--help" | "-h" => {
                print_usage();
                return Ok(());
            }
            other => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown argument {other}"),
                ));
            }
        }
    }

    let mut emulator = Emulator::new();
    emulator.load_rom_file(&rom_path)?;
    if let Some(header) = &emulator.rom_header {
        println!(
            "Loaded {} | region {:?} | timing {:?} | reset PC ${:06X}",
            if header.overseas_name.is_empty() {
                "<unnamed>"
            } else {
                &header.overseas_name
            },
            emulator.region,
            emulator.timing,
            emulator.cpu.pc
        );
    } else {
        println!("Loaded ROM | reset PC ${:06X}", emulator.cpu.pc);
    }

    let mut last = None;
    for _ in 0..frames {
        last = Some(emulator.run_frame());
    }

    if let Some(run) = last {
        println!(
            "Ran {} frame(s), last frame: {} cycles, {} steps, {:.3} ms{}",
            emulator.frame_count,
            run.cpu_cycles,
            run.cpu_steps,
            run.elapsed.as_secs_f64() * 1000.0,
            if run.hit_unsupported_opcode {
                " (stopped at unsupported opcode)"
            } else {
                ""
            }
        );
        if let Some(err) = &emulator.last_error {
            println!("Last CPU error: {err:?}");
        }
    }

    if let Some(path) = dump_path {
        write_ppm(&path, emulator.framebuffer(), emulator.frame_size())?;
        println!("Wrote {}", path.display());
    }

    Ok(())
}

fn print_usage() {
    println!("usage: euther-oxide <rom.md|rom.bin|rom.smd> [--frames N] [--dump frame.ppm]");
}

fn write_ppm(
    path: &PathBuf,
    framebuffer: &[u32],
    (width, height): (usize, usize),
) -> io::Result<()> {
    let mut file = File::create(path)?;
    write!(file, "P6\n{} {}\n255\n", width, height)?;
    for &pixel in framebuffer.iter().take(width * height) {
        file.write_all(&[
            ((pixel >> 16) & 0xff) as u8,
            ((pixel >> 8) & 0xff) as u8,
            (pixel & 0xff) as u8,
        ])?;
    }
    Ok(())
}
