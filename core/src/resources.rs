use sysinfo::System;
use serde::Serialize;

#[derive(Serialize)]
pub struct ResourceUsage {
    cpu: f32,
    memory: u64,
}

pub fn get_usage() -> ResourceUsage {
    let mut system = System::new_all();
    system.refresh_all();
    let cpu_usage = system.cpus().iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / system.cpus().len() as f32;
    ResourceUsage {
        cpu: cpu_usage,
        memory: system.used_memory() / 1024 / 1024, // MB
    }
}
