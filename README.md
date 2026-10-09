# Self Automate — agent

The Windows agent of **Self Automate**, an automation platform. It runs as a
single executable (`bot-agente.exe`, a Node.js Single Executable Application)
on the machine where the automations must run, and talks to the Self Automate
console over HTTPS.

The agent is a **shell**: it carries no automation of its own. The robots it
runs come in a package published by the console and signed with the
publisher's key; the agent checks that signature before loading anything, and
refuses a package that does not verify.

## Install and uninstall

Download the agent from the console ("Meus dispositivos" → "Baixar o agente para
Windows") and open it.
Before changing anything, it tells you what it will do and waits for Enter:

- copy itself to `%LOCALAPPDATA%\SelfAutomate` (no administrator rights);
- open the browser so a signed-in user confirms the connection to the console;
- create the shortcut `Self Automate - agente.cmd` in the Windows Startup
  folder and on the Desktop, so the agent starts when you sign in.

To remove it, open a window and run:

```
bot-agente --desinstalar
```

It shows what it will remove and waits for Enter, then stops the agent and
removes the shortcuts, the scheduled task `SelfAutomate-Agente` (if there is
one) and the `%LOCALAPPDATA%\SelfAutomate` folder. The computer stays listed in
the console until you remove it under "Meus dispositivos".

## Privacy

The agent connects only to the Self Automate console it was paired with —
chosen by whoever installs it — and to the systems that the automations
published to it are configured to use. It does not send data anywhere else.

## Code signing policy

Windows releases are to be signed through the SignPath Foundation: free code
signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org). The project is applying for it;
until releases are signed, Windows shows a SmartScreen warning when the agent
is opened, and releases are not signed yet.

Every release is built by this repository's GitHub Actions workflow
(`.github/workflows/empacotar.yml`) from the tagged source, and is approved
for signing by hand.

Team roles:

- **Committers and reviewers**: [members of the self-automate organization](https://github.com/orgs/self-automate/people)
- **Approvers**: [owners of the self-automate organization](https://github.com/orgs/self-automate/people?query=role%3Aowner)

## Build

Requires the Node.js version in `.nvmrc`, on Windows (the executable is the
`node.exe` of the build machine with the application injected).

```
npm ci
npm run typecheck
npm run empacotar
```

## License

Apache-2.0 — see [LICENSE](LICENSE).

---

## Em português

O agente Windows do **Self Automate**. Roda como um executável único na máquina
onde as automações precisam rodar e fala com o console por HTTPS. É uma
**casca**: não traz robô nenhum — os robôs chegam num pacote publicado pelo
console e assinado, e o agente confere a assinatura antes de carregar qualquer
coisa.

Antes de instalar, ele diz o que vai mudar e espera o Enter. Para remover:
`bot-agente --desinstalar`.

Licença Apache-2.0.
