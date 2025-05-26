use sysinfo::{System, SystemExt, CpuExt};
use serde::Serialize;

#[derive(Serialize)]
pub struct ResourceUsage {
    cpu: f32,
    memory: u64,
}

pub fn get_usage() -> ResourceUsage {
    let mut system = System::new_all();
    system.refresh_all();
    ResourceUsage {
        cpu: system.global_cpu_info().cpu_usage(),
        memory: system.used_memory() / 1024 / 1024, // MB
    }
}
