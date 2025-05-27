use druid::widget::{Button, Flex, Label, TextBox};
use druid::{AppDelegate, Command, DelegateCtx, Env, Handled, Target, Widget, WidgetExt};
use druid::piet::Color;
use reqwest::Client;
use serde_json::json;

pub struct AppState {
    pub terminal_output: String,
}

pub fn build_ui() -> impl Widget<AppState> {
    // Główny kontener
    let mut main_layout = Flex::column()
        .with_child(
            Flex::row()
                // Terminal w lewym górnym rogu
                .with_child(
                    Flex::column()
                        .with_child(Label::new("Terminal Output"))
                        .with_child(
                            TextBox::multiline()
                                .with_placeholder("Output will appear here...")
                                .lens(AppState::terminal_output)
                                .fix_size(400.0, 200.0)
                                .disabled()
                        )
                        .padding(10.0)
                )
                // Narzędzia w prawym górnym rogu
                .with_child(
                    Flex::column()
                        .with_child(Label::new("Penetration Testing Tools"))
                        .with_child(
                            Button::new("Run Nmap Scan")
                                .on_click(|ctx, _data, _env| {
                                    ctx.submit_command(Command::new(
                                        RUN_NMAP,
                                        String::from("nmap -sP 192.168.1.0/24"),
                                        Target::Auto,
                                    ));
                                })
                        )
                        .with_child(
                            Button::new("Run SQLMap")
                                .on_click(|ctx, _data, _env| {
                                    ctx.submit_command(Command::new(
                                        RUN_SQLMAP,
                                        String::from("sqlmap -u http://example.com"),
                                        Target::Auto,
                                    ));
                                })
                        )
                        .with_child(
                            Button::new("Launch Metasploit")
                                .on_click(|ctx, _data, _env| {
                                    ctx.submit_command(Command::new(
                                        RUN_METASPLOIT,
                                        String::from("msfconsole"),
                                        Target::Auto,
                                    ));
                                })
                        )
                        .padding(10.0)
                )
        )
        // Reszta interfejsu (przykładowa treść w centrum)
        .with_child(
            Label::new("Main Content Area\nCustomize this section as needed")
                .with_text_size(16.0)
                .center()
        );

    // Ustawienie półprzezroczystego tła
    main_layout.set_background(Color::rgba8(0, 0, 0, 128)); // Półprzezroczyste czarne tło

    main_layout
}

// Komendy dla przycisków
const RUN_NMAP: druid::Selector<String> = druid::Selector::new("run-nmap");
const RUN_SQLMAP: druid::Selector<String> = druid::Selector::new("run-sqlmap");
const RUN_METASPLOIT: druid::Selector<String> = druid::Selector::new("run-metasploit");

pub struct Delegate {
    client: Client,
}

impl AppDelegate<AppState> for Delegate {
    fn command(
        &mut self,
        ctx: &mut DelegateCtx,
        _target: Target,
        cmd: &Command,
        data: &mut AppState,
        _env: &Env,
    ) -> Handled {
        if let Some(command) = cmd.get(RUN_NMAP).or(cmd.get(RUN_SQLMAP)).or(cmd.get(RUN_METASPLOIT)) {
            let client = self.client.clone();
            let command = command.clone();
            ctx.submit_command(async move {
                let json = json!({
                    "image": "alpine",
                    "command": command,
                    "profile": "default",
                    "use_gpu": false,
                    "priority": 5
                });
                match client
                    .post("http://127.0.0.1:8080/api/container/start")
                    .json(&json)
                    .send()
                    .await
                {
                    Ok(resp) => {
                        let text = resp.text().await.unwrap_or("No response".to_string());
                        druid::commands::SET_MAIN_WINDOW_TITLE
                            .to(Target::Global)
                            .with(format!("Response: {}", text))
                            .send(ctx);
                        druid::commands::UPDATE_DATA
                            .to(Target::Global)
                            .with(AppState {
                                terminal_output: format!("{}\n{}", data.terminal_output, text),
                            })
                            .send(ctx);
                    }
                    Err(e) => {
                        druid::commands::UPDATE_DATA
                            .to(Target::Global)
                            .with(AppState {
                                terminal_output: format!("{}\nError: {}", data.terminal_output, e),
                            })
                            .send(ctx);
                    }
                }
            });
            Handled::Yes
        } else {
            Handled::No
        }
    }
}

impl Delegate {
    pub fn new() -> Self {
        Delegate {
            client: Client::new(),
        }
    }
}
