//! Install the Windows toolchain carried by a standalone reactc executable.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail, ensure};
use sha2::{Digest, Sha256};

// The packager appends the archive (when present), its optional download URL,
// and this fixed-size footer after the PE image.
const MAGIC: &[u8; 8] = b"RCTPACK1";
const FOOTER_SIZE: u64 = 56;
const RELEASES: &str = "https://github.com/sil3nt884/reactc/releases/download/";

struct Payload {
    executable: File,
    length: u64,
    archive_offset: u64,
    digest: [u8; 32],
    url: String,
}

impl Payload {
    fn read(executable: &Path) -> Result<Option<Self>> {
        let mut executable = File::open(executable)?;
        let size = executable.metadata()?.len();
        if size < FOOTER_SIZE {
            return Ok(None);
        }
        executable.seek(SeekFrom::End(-(FOOTER_SIZE as i64)))?;
        let mut footer = [0; FOOTER_SIZE as usize];
        executable.read_exact(&mut footer)?;
        if &footer[48..] != MAGIC {
            return Ok(None);
        }
        let length = u64::from_le_bytes(footer[..8].try_into()?);
        let url_length = u64::from_le_bytes(footer[8..16].try_into()?);
        ensure!(url_length <= 1024, "invalid toolchain URL length");
        let url_offset = (size - FOOTER_SIZE)
            .checked_sub(url_length)
            .context("invalid toolchain URL offset")?;
        let archive_offset = url_offset
            .checked_sub(length)
            .context("invalid embedded toolchain offset")?;
        executable.seek(SeekFrom::Start(url_offset))?;
        let mut url = vec![0; url_length as usize];
        executable.read_exact(&mut url)?;
        let url = String::from_utf8(url)?;
        ensure!(
            length > 0 || url.starts_with(RELEASES),
            "invalid toolchain download URL"
        );
        Ok(Some(Self {
            executable,
            length,
            archive_offset,
            digest: footer[16..48].try_into()?,
            url,
        }))
    }

    fn archive(&mut self, destination: &Path) -> Result<()> {
        if self.length > 0 {
            println!("Installing the toolchain from reactc.exe...");
            self.executable.seek(SeekFrom::Start(self.archive_offset))?;
            let copied = std::io::copy(
                &mut (&mut self.executable).take(self.length),
                &mut File::create(destination)?,
            )?;
            ensure!(copied == self.length, "embedded toolchain is truncated");
        } else if let Some(archive) = std::env::var_os("REACTC_TOOLCHAIN_ARCHIVE") {
            fs::copy(archive, destination).context("cannot read REACTC_TOOLCHAIN_ARCHIVE")?;
        } else {
            println!("Downloading the ReactC Windows toolchain (first build only)...");
            let status = Command::new(system_tool("curl.exe"))
                .args([
                    "--disable",
                    "--fail",
                    "--location",
                    "--proto",
                    "=https",
                    "--proto-redir",
                    "=https",
                    "--retry",
                    "2",
                    "--connect-timeout",
                    "30",
                    "--output",
                ])
                .arg(destination)
                .arg(&self.url)
                .status()
                .context("cannot start Windows curl.exe")?;
            ensure!(
                status.success(),
                "toolchain download failed ({status}) from {}",
                self.url
            );
        }
        let mut archive = File::open(destination)?;
        let mut hash = Sha256::new();
        std::io::copy(&mut archive, &mut hash)?;
        ensure!(
            hash.finalize().as_slice() == self.digest,
            "toolchain archive SHA-256 does not match this reactc.exe"
        );
        Ok(())
    }
}

fn system_tool(name: &str) -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into()))
        .join("System32")
        .join(name)
}

fn ready(root: &Path) -> bool {
    root.join("src").join("page-runtime.js").is_file()
        && root
            .join("tools")
            .join("mingw64")
            .join("bin")
            .join("gcc.exe")
            .is_file()
        && root.join("tools").join("node").join("node.exe").is_file()
}

pub fn has_payload(executable: &Path) -> Result<bool> {
    Ok(Payload::read(executable)?.is_some())
}

pub fn home(executable: &Path) -> Result<Option<PathBuf>> {
    let Some(mut payload) = Payload::read(executable)? else {
        return Ok(None);
    };
    let cache = match std::env::var_os("REACTC_CACHE_DIR") {
        Some(path) => crate::absolute(PathBuf::from(path))?,
        None => PathBuf::from(std::env::var_os("LOCALAPPDATA").context("LOCALAPPDATA is unset")?)
            .join("reactc")
            .join("toolchains"),
    };
    let digest: String = payload
        .digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let root = cache.join(digest);
    if ready(&root) {
        return Ok(Some(root));
    }
    if root.exists() {
        bail!(
            "toolchain cache is incomplete: remove {} and run reactc again",
            root.display()
        );
    }
    fs::create_dir_all(&cache)?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let stage = cache.join(format!(".install-{}-{timestamp}", std::process::id()));
    fs::create_dir(&stage)?;
    let result = (|| -> Result<()> {
        let archive = stage.join("toolchain.zip");
        payload.archive(&archive)?;
        let status = Command::new(system_tool("tar.exe"))
            .arg("-xf")
            .arg(&archive)
            .arg("-C")
            .arg(&stage)
            .status()
            .context("cannot start Windows tar.exe")?;
        ensure!(status.success(), "toolchain extraction failed ({status})");
        let unpacked = stage.join("reactc-windows-x64");
        ensure!(ready(&unpacked), "archive is missing the Windows toolchain");
        match fs::rename(&unpacked, &root) {
            Ok(()) => Ok(()),
            Err(_) if ready(&root) => Ok(()),
            Err(error) => Err(error)
                .with_context(|| format!("cannot install toolchain at {}", root.display())),
        }
    })();
    let _ = fs::remove_dir_all(&stage);
    result?;
    Ok(Some(root))
}
