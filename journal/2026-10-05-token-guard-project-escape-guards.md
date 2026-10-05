# 2026-10-05 — `opencode-token-guard`: Guards gegen Projekt-Flucht & Offloading auf den User

Zwei neue Tripwires gegen einen beobachteten Fehlschlag: Nach einem Permission-Prompt
für eine **in-projekt** Aktion (ein Python-Heredoc schrieb eine Projekt-Datei, opencode
fragte daraufhin „Access external directory ~/js") bog der Agent falsch ab — er
verlagerte die Arbeit aus dem Projektordner heraus und bat den User, sie dort
auszuführen. Beide Guards schließen diese Schleife von zwei Seiten.

## Was

- **`mutatesOutsideProject()`** blockt Bash-Befehle, die Dateisystem-Zustand **außerhalb
  des Projekt-Roots** mutieren: Redirect-Ziele außerhalb, Outside-Operanden bei
  `mkdir`/`touch`/`rm`/`tee`/`ln`/`sed -i`, sowie `cd` nach außerhalb kombiniert mit
  Write-Hint (inkl. Heredoc-Writes via `open(…,'w')`/`json.dump`). Der Block-Reason, den
  das Modell sieht, schreibt den korrekten Recovery vor: Änderung in-projekt mit
  edit/write redo, Befehl verengen, **nie** an den User abgeben.
- **`isOffloadAsk()`** warnt, wenn der Assistant-Text die Arbeit an den User delegiert
  („run this yourself", „in your terminal", „führe das selbst aus", „außerhalb des
  Projekts"). Text-Parts werden beim Streaming (`message.part.updated`) gepuffert und bei
  Message-Abschluss gescannt.
- Beide zählen in die Metrics-JSON (`blockedOutsideMutation`, `offloadAsk`); README und
  `/token-guard`-Command-Doc dokumentiert.

## Entscheidungen

- **Block nur bei klarer Outside-Mutation, bewusst konservativ.** Reads von außerhalb
  (`cat ~/.config/…`) und Scratch (`/tmp`, `/var/folders`, `/dev`) bleiben frei; der
  ursprüngliche Heredoc-Befehl des Vorfalls (komplett in-projekt) wird korrekt
  **nicht** geblockt. Tripwire, kein Sandbox — ein Fehlblock kostet einen Step und
  trifft eine Regel-Begründung, mit der das Modell arbeiten kann.
- **Offload-Warnung als Log, nicht als Injektion.** Der Warning-Text geht ans
  `client.app.log` (sichtbar für den User), nicht als Turn ins Gespräch — konsistent mit
  der Plugin-Philosophie „tripwire, not autopilot".
- **Projekt-Root aus dem Plugin-Input (`directory`)**, keine neue Config, keine neuen
  `TOKEN_GUARD_*`-Variablen.

## Learnings

- Der Permission-Prompt selbst war eine Art **False Positive der Sandbox** — der Bash-
  Befehl war in-projekt. Der eigentliche Schaden entstand erst in der **Reaktion** des
  Agenten darauf. Guards müssen deshalb am Verhalten nach dem Friction-Punkt Ansetzen,
  nicht nur am Befehl.
- `PluginInput.directory` ist die zuverlässige Quelle für den Projekt-Root — cwd-Heuristiken
  wären nach `cd`-Ketten im Befehl brüchig geworden.

## Follow-ups

- Das Plugin hat weiterhin **keine Test-Suite** (`tests/opencode-token-guard/` fehlt);
  die Detektoren sind als reine Funktionen in `guard.ts` gehalten, gezielt
  unit-testbar. Harness-Aufbau ist der nächste nennenswerte Schritt.
- I18N der Offload-Patterns deckt EN/DE; weitere Sprachen nach Bedarf ergänzen.
