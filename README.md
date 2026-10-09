# Self Automate — agent

The Windows agent of **Self Automate**, an automation platform. It runs as a
single executable (`bot-agente.exe`, a Node.js Single Executable Application)
on the machine where the automations must run, and talks to the Self Automate
console over HTTPS.

The agent is a **shell**: it carries no automation of its own. The robots it
runs come in a package published by the console and signed with the
publisher's key; the agent checks that signature before loading anything, and
refuses a package that does not verify.

## Build

Requires the Node.js version in `.nvmrc`, on Windows (the executable is the
`node.exe` of the build machine with the application injected).

```
npm ci
npm run typecheck
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

Licença Apache-2.0.
