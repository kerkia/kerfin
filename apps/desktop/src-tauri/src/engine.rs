//! Runs the Python engine beside the app and tells the UI how to reach it.
//!
//! The engine listens on 127.0.0.1 with a token generated here at each launch. Its stdin
//! stays open while the app runs; when the app goes away, the engine exits too.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

const READY_PREFIX: &str = "KERFIN_ENGINE_READY ";
// The first launch can be slow while antivirus software scans the bundled Python.
const START_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Serialize)]
pub struct EngineInfo {
    url: String,
    token: String,
}

#[derive(Default)]
pub struct Engine {
    child: Mutex<Option<Child>>,
    info: Mutex<Option<Result<EngineInfo, String>>>,
    ready: Condvar,
}

impl Engine {
    fn publish(&self, result: Result<EngineInfo, String>) {
        *self.info.lock().unwrap() = Some(result);
        self.ready.notify_all();
    }

    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Starts the engine in the background; `engine_info` waits for it.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let engine = app.state::<Engine>();
        match launch(&app) {
            Ok((info, child)) => {
                *engine.child.lock().unwrap() = Some(child);
                engine.publish(Ok(info));
            }
            Err(error) => engine.publish(Err(error)),
        }
    });
}

#[tauri::command]
pub async fn engine_info(app: AppHandle) -> Result<EngineInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = app.state::<Engine>();
        let guard = engine.info.lock().unwrap();
        let (guard, _) = engine
            .ready
            .wait_timeout_while(guard, START_TIMEOUT, |info| info.is_none())
            .unwrap();
        (*guard).clone().unwrap_or_else(|| Err("The engine is still starting".into()))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Stops the engine so that an update can replace its files.
#[tauri::command]
pub fn stop_engine(engine: State<'_, Engine>) {
    engine.stop();
}

fn launch(app: &AppHandle) -> Result<(EngineInfo, Child), String> {
    let token = random_token()?;
    let paths = app.path();
    let data_dir = paths.app_local_data_dir().map_err(|e| e.to_string())?.join("data");
    let log_dir = paths.app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log = open_log(&log_dir.join("engine.log")).map_err(|e| e.to_string())?;

    let mut command = engine_command(app)?;
    command
        .env("KERFIN_TOKEN", &token)
        .env("KERFIN_DATA_DIR", plain(&data_dir))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|e| format!("Cannot start the engine: {e}"))?;

    let stdout = child.stdout.take().ok_or("No engine output")?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => {
                    let _ = sender.send(None);
                    return;
                }
                Ok(_) => {
                    if let Some(port) = line.trim().strip_prefix(READY_PREFIX) {
                        let _ = sender.send(Some(port.to_string()));
                        break;
                    }
                }
            }
        }
        // Keep reading so the engine never blocks on a full pipe.
        let _ = std::io::copy(&mut reader, &mut std::io::sink());
    });

    match receiver.recv_timeout(START_TIMEOUT) {
        Ok(Some(port)) => Ok((EngineInfo { url: format!("http://127.0.0.1:{port}"), token }, child)),
        _ => {
            let _ = child.kill();
            Err(format!("The engine did not start; see {}", log_dir.join("engine.log").display()))
        }
    }
}

fn engine_command(app: &AppHandle) -> Result<Command, String> {
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("engine");
    let python = if cfg!(windows) {
        bundled.join("python").join("python.exe")
    } else {
        bundled.join("python").join("bin").join("python3")
    };
    if python.exists() {
        let mut command = Command::new(plain(&python));
        command
            .args(["-I", "-m", "kerfin_engine", "serve", "--watch-stdin"])
            .env("KERFIN_WOOB_MODULES", plain(&bundled.join("woob-modules")));
        return Ok(command);
    }
    if cfg!(debug_assertions) {
        // `tauri dev`: run the engine from the source checkout.
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../engine");
        let mut command = Command::new("uv");
        command
            .arg("run")
            .arg("--project")
            .arg(project)
            .args(["kerfin-engine", "serve", "--watch-stdin"]);
        return Ok(command);
    }
    Err(format!("Engine not found in {}", bundled.display()))
}

/// The engine log, kept across launches (an update restarts the app) and rotated at 1 MB.
fn open_log(path: &Path) -> std::io::Result<File> {
    const MAX_LOG_BYTES: u64 = 1024 * 1024;
    if std::fs::metadata(path).is_ok_and(|meta| meta.len() > MAX_LOG_BYTES) {
        let old = path.with_extension("old.log");
        let _ = std::fs::remove_file(&old); // Windows can't rename onto an existing file
        let _ = std::fs::rename(path, old);
    }
    std::fs::OpenOptions::new().create(true).append(true).open(path)
}

/// Windows paths without the `\\?\` prefix, which Python can't locate its library from.
fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
