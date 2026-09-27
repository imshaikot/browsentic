use serde::Serialize;
use std::path::{Path, PathBuf};

const EXE: &str = std::env::consts::EXE_SUFFIX;

/// Where Browsentic keeps everything, laid out exactly as the macOS app and `npx browsentic setup` lay it out.
#[derive(Clone, Debug)]
pub struct Paths {
    pub home: PathBuf,
}

impl Paths {
    /// A debug build can be pointed at a scratch home, so working on the app never touches the real install.
    pub fn from_env() -> Self {
        let scratch = cfg!(debug_assertions).then(|| std::env::var_os("BROWSENTIC_APP_HOME")).flatten();
        let home = scratch
            .or_else(|| std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }))
            .map(PathBuf::from)
            .unwrap_or_default();
        Self { home }
    }

    pub fn state(&self) -> PathBuf {
        self.home.join(".browsentic")
    }
    pub fn cli(&self) -> PathBuf {
        self.state().join("cli")
    }
    pub fn cli_entry(&self) -> PathBuf {
        self.cli().join("dist").join("cli.js")
    }
    pub fn cli_manifest(&self) -> PathBuf {
        self.cli().join("package.json")
    }
    pub fn app_marker(&self) -> PathBuf {
        self.cli().join(".browsentic-app.json")
    }
    pub fn bin(&self) -> PathBuf {
        self.state().join("bin")
    }
    pub fn shim(&self) -> PathBuf {
        self.bin().join(format!("browsentic{EXE}"))
    }
    pub fn mcp_shim(&self) -> PathBuf {
        self.bin().join(format!("browsentic-mcp{EXE}"))
    }
    pub fn runtime(&self) -> PathBuf {
        self.state().join("runtime")
    }
    pub fn private_node(&self) -> PathBuf {
        let node = self.runtime().join("node");
        if cfg!(windows) { node.join("node.exe") } else { node.join("bin").join("node") }
    }
    pub fn lockfile(&self) -> PathBuf {
        self.state().join("daemon.json")
    }
    pub fn log(&self) -> PathBuf {
        self.state().join("daemon.log")
    }
    pub fn config(&self) -> PathBuf {
        self.state().join("config.json")
    }
    pub fn default_extension(&self) -> PathBuf {
        self.home.join("browsentic").join("extension").join("chrome-mv3")
    }

    /// `extensionDir` in config.json when someone chose one, the default otherwise.
    pub fn extension_dir(&self) -> PathBuf {
        std::fs::read_to_string(self.config())
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|config| config.get("extensionDir")?.as_str().filter(|dir| !dir.is_empty()).map(|dir| self.expand(dir)))
            .unwrap_or_else(|| self.default_extension())
    }

    fn expand(&self, dir: &str) -> PathBuf {
        match dir.strip_prefix("~/").or_else(|| dir.strip_prefix("~\\")) {
            Some(rest) => self.home.join(rest),
            None => PathBuf::from(dir),
        }
    }

    pub fn view(&self) -> PathsView {
        PathsView {
            home: self.home.clone(),
            state: self.state(),
            extension_dir: self.extension_dir(),
            log: self.log(),
            shim: self.shim(),
            mcp_shim: self.mcp_shim(),
            bin: self.bin(),
            config: self.config(),
            separator: std::path::MAIN_SEPARATOR,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsView {
    pub home: PathBuf,
    pub state: PathBuf,
    pub extension_dir: PathBuf,
    pub log: PathBuf,
    pub shim: PathBuf,
    pub mcp_shim: PathBuf,
    pub bin: PathBuf,
    pub config: PathBuf,
    pub separator: char,
}

pub fn same_dir(a: &Path, b: &Path) -> bool {
    let normal = |path: &Path| path.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
    normal(a) == normal(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(home: &Path) -> Paths {
        Paths { home: home.to_path_buf() }
    }

    #[test]
    fn keeps_the_layout_every_other_install_uses() {
        let paths = at(Path::new("/h"));
        assert_eq!(paths.cli_entry(), Path::new("/h/.browsentic/cli/dist/cli.js"));
        assert_eq!(paths.lockfile(), Path::new("/h/.browsentic/daemon.json"));
        assert_eq!(paths.default_extension(), Path::new("/h/browsentic/extension/chrome-mv3"));
        assert_eq!(paths.shim().file_stem().unwrap(), "browsentic");
    }

    #[test]
    fn follows_an_extension_folder_chosen_in_config() {
        let home = tempfile::tempdir().unwrap();
        let paths = at(home.path());
        std::fs::create_dir_all(paths.state()).unwrap();
        assert_eq!(paths.extension_dir(), paths.default_extension());

        std::fs::write(paths.config(), r#"{"extensionDir":"~/elsewhere/ext"}"#).unwrap();
        assert_eq!(paths.extension_dir(), home.path().join("elsewhere/ext"));

        std::fs::write(paths.config(), r#"{"extensionDir":""}"#).unwrap();
        assert_eq!(paths.extension_dir(), paths.default_extension());
    }

    #[test]
    fn compares_folders_the_way_windows_does() {
        assert!(same_dir(Path::new(r"C:\Users\Me\.browsentic\bin\"), Path::new(r"c:\users\me\.browsentic\bin")));
        assert!(!same_dir(Path::new(r"C:\a"), Path::new(r"C:\b")));
    }
}
