"use client";

import { useEffect, useRef, useState } from "react";
import { KEYED_PROVIDERS, type KeyedProvider } from "@/lib/provider-ids";
import { KEY_HELP, maskKey, readKey, writeKey } from "@/lib/client-keys";
import { getSoundSettings, playSound, setSoundSettings } from "@/lib/sounds";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  // Mounted only while open, so its state is read fresh from storage each time.
  return isOpen ? <SettingsDialog onClose={onClose} /> : null;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [sound, setSound] = useState(getSoundSettings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div ref={dialog} className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <h2 id="settings-title" className="text-lg font-bold">
            Settings
          </h2>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close settings">
            ✕
          </button>
        </header>

        <div className="space-y-6 px-6 py-5">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">API keys</h3>
              <p className="mt-1 text-xs text-slate-500">
                Bring your own. Keys stay in this browser and are sent only with matches that need them. Built-in engines need no key.
              </p>
            </div>
            {KEYED_PROVIDERS.map((p) => (
              <KeyField key={p} provider={p} />
            ))}
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">Sound</h3>
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sound.enabled}
                onChange={(e) => {
                  setSound(setSoundSettings({ enabled: e.target.checked }));
                  if (e.target.checked) playSound("move");
                }}
                className="h-4 w-4 accent-slate-900"
              />
              Play move sounds
            </label>
            {sound.enabled && (
              <div className="flex items-center gap-3 pl-7">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(sound.volume * 100)}
                  onChange={(e) => setSound(setSoundSettings({ volume: Number(e.target.value) / 100 }))}
                  className="flex-1 accent-slate-900"
                  aria-label="Volume"
                />
                <span className="w-10 text-right text-xs tabular-nums text-slate-500">{Math.round(sound.volume * 100)}%</span>
                <button onClick={() => (["move", "capture", "check"] as const).forEach((k, i) => setTimeout(() => playSound(k, true), i * 220))} className="text-xs font-medium text-slate-600 underline underline-offset-2">
                  Test
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function KeyField({ provider }: { provider: KeyedProvider }) {
  const help = KEY_HELP[provider];
  const [saved, setSaved] = useState(() => readKey(provider));
  const [draft, setDraft] = useState(saved);
  const [show, setShow] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  function save(value: string) {
    writeKey(provider, value);
    const current = readKey(provider);
    setSaved(current);
    setDraft(current);
    setFlash(current ? "Saved" : "Removed");
    setTimeout(() => setFlash(null), 1500);
  }

  const dirty = draft.trim() !== saved;
  const id = `key-${provider}`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-semibold text-slate-700">
          {help.label}
        </label>
        <span className="text-[11px] text-slate-500">
          {flash ? <span className="text-emerald-600">{flash}</span> : saved ? `Saved · ${maskKey(saved)}` : "Not set"}
        </span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            id={id}
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dirty && save(draft)}
            placeholder={help.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-slate-200 py-2 pl-3 pr-12 font-mono text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            data-testid={`key-input-${provider}`}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-2 text-[11px] font-medium text-slate-500 hover:text-slate-800"
            aria-label={show ? "Hide key" : "Show key"}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <button
          onClick={() => save(draft)}
          disabled={!dirty}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
          data-testid={`key-save-${provider}`}
        >
          Save
        </button>
        {saved && (
          <button onClick={() => save("")} className="rounded-lg px-2 text-sm text-slate-500 hover:bg-slate-100" aria-label={`Remove ${help.label} key`}>
            Remove
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Get one at{" "}
        <a href={help.url} target="_blank" rel="noopener noreferrer" className="text-slate-600 underline underline-offset-2">
          {help.host}
        </a>
      </p>
    </div>
  );
}
