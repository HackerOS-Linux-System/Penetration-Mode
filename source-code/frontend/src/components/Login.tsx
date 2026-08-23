import { createSignal, Show } from "solid-js";
import { ShieldAlert, Loader2 } from "lucide-solid";
import { login, type Session } from "../lib/tauri";

interface Props {
  onSuccess: (session: Session) => void;
}

/**
 * Ekran logowania — loguje realnym kontem systemowym (Linux/PAM), patrz
 * source-code/backend/src/auth.rs. To ten sam login/hasło co do `su`/konsoli
 * na tym hoście; jeśli host ma PAM/NSS podpięte pod firmowe LDAP/SSSD, leci
 * to automatycznie przez to źródło. Kontrakt (`login(user, pass) -> Session`)
 * zostaje ten sam niezależnie od tego, co robi PAM pod spodem.
 */
export function Login(props: Props) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await login(username(), password());
      props.onSuccess(session);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="h-screen w-full bg-[var(--bg-app)] flex items-center justify-center">
      <div class="w-80 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-6 shadow-lg flex flex-col gap-4">
        <div class="flex items-center gap-2 justify-center mb-2">
          <div class="w-3 h-3 bg-[var(--accent)] rounded-full shadow-[0_0_8px_var(--accent)] animate-pulse" />
          <span class="font-bold tracking-tighter text-sm text-[var(--accent)]">
            PENETRATION MODE <span class="text-white font-normal opacity-50">// RED TEAM</span>
          </span>
        </div>

        <form onSubmit={handleSubmit} class="flex flex-col gap-3">
          <div>
            <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)] block mb-1">Login</label>
            <input
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              autofocus
              class="w-full bg-[var(--bg-app)] border border-[var(--border-strong)] rounded px-3 py-2 text-[11px] text-[var(--text-primary)] font-mono outline-none focus:border-[var(--accent-50)]"
            />
          </div>
          <div>
            <label class="text-[9px] uppercase tracking-widest text-[var(--text-muted)] block mb-1">Hasło</label>
            <input
              type="password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              class="w-full bg-[var(--bg-app)] border border-[var(--border-strong)] rounded px-3 py-2 text-[11px] text-[var(--text-primary)] font-mono outline-none focus:border-[var(--accent-50)]"
            />
          </div>

          <Show when={error()}>
            <div class="flex items-start gap-1.5 text-[9px] text-[#ff5555]">
              <ShieldAlert size={12} class="shrink-0 mt-0.5" />
              <span>{error()}</span>
            </div>
          </Show>

          <button
            type="submit"
            disabled={loading()}
            class="w-full py-2 mt-1 bg-[var(--accent)] hover:bg-[#ff5555] text-black text-[10px] font-bold uppercase tracking-widest rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Show when={loading()}>
              <Loader2 size={12} class="animate-spin" />
            </Show>
            Zaloguj
          </button>
        </form>

        <p class="text-[8px] text-[var(--text-disabled)] text-center leading-relaxed">
          Logowanie kontem systemowym tego hosta (PAM). Rola (Operator/Lead/
          Auditor) zależy od przynależności do grup uniksowych.
        </p>
      </div>
    </div>
  );
}
