import { powershell } from '../blocos/powershell.js';
import { ehGestoNaoGravado, type AcaoGravada, type AlvoNaJanela, type GestoNaoGravado, type NaoGravados } from './gravacao.js';
export interface ElementoNaTela {
    titulo: string;
    id?: string;
    nome?: string;
    tipo: string;
    campo: boolean;
    senha: boolean;
    processo?: number;
    programa?: string;
}
export type EventoDeJanela = ({
    tipo: 'clique';
    el: ElementoNaTela;
} | {
    tipo: 'foco';
    el: ElementoNaTela;
    valor: string | null;
} | {
    tipo: 'saiu';
    el: ElementoNaTela;
    valor: string | null;
    teclas: number;
} | {
    tipo: 'tecla';
    tecla: 'ENTER' | 'ESC';
    el: ElementoNaTela | null;
    valor?: string | null;
    teclas?: number;
} | {
    tipo: 'gesto';
    gesto: GestoNaoGravado;
    el: ElementoNaTela | null;
}) & {
    em?: number;
};
export function idEstavel(id: string | undefined): string | undefined {
    const t = (id ?? '').trim();
    if (!t)
        return undefined;
    if (/^\d+$/.test(t) && Number(t) > 65535)
        return undefined;
    return t;
}
const alvoDe = (e: ElementoNaTela): AlvoNaJanela | undefined => {
    const id = idEstavel(e.id);
    return id ? { id } : e.nome ? { nome: e.nome } : undefined;
};
const mesmo = (a: ElementoNaTela, b: ElementoNaTela): boolean => a.titulo === b.titulo && (a.id ?? '') === (b.id ?? '') && (a.nome ?? '') === (b.nome ?? '');
export function montarAcoesDeJanela(eventos: EventoDeJanela[], ignorar?: (el: ElementoNaTela) => boolean, fora?: (el: ElementoNaTela) => boolean): {
    acoes: AcaoGravada[];
    momentos: number[];
    semAlvo: number;
    naoGravados: NaoGravados;
    foraDaGravacao: number;
} {
    const acoes: AcaoGravada[] = [];
    const momentos: number[] = [];
    const naoGravados: NaoGravados = {};
    let foraDaGravacao = 0;
    let quando = 0;
    const empurrar = (a: AcaoGravada): void => {
        acoes.push(a);
        momentos.push(quando);
    };
    let semAlvo = 0;
    let campo: {
        el: ElementoNaTela;
        inicial: string | null;
    } | undefined;
    const digitado = (el: ElementoNaTela, valor: string | null | undefined, teclas: number): void => {
        const alvo = alvoDe(el);
        if (!alvo) {
            if (teclas > 0)
                semAlvo++;
            return;
        }
        if (el.senha) {
            if (teclas > 0)
                empurrar({ tipo: 'janela.digitarSegredo', titulo: el.titulo, alvo });
            return;
        }
        const inicial = campo && mesmo(campo.el, el) ? campo.inicial : null;
        if (typeof valor === 'string' && valor !== inicial)
            empurrar({ tipo: 'janela.digitar', titulo: el.titulo, alvo, valor });
    };
    for (const [i, e] of eventos.entries()) {
        if (ignorar && e.el && ignorar(e.el))
            continue;
        if (fora && e.el && fora(e.el)) {
            if (e.tipo === 'clique')
                foraDaGravacao++;
            continue;
        }
        quando = e.em ?? i;
        switch (e.tipo) {
            case 'clique': {
                if (e.el.campo)
                    break;
                const alvo = alvoDe(e.el);
                if (alvo)
                    empurrar({ tipo: 'janela.clicar', titulo: e.el.titulo, alvo });
                else
                    semAlvo++;
                break;
            }
            case 'foco':
                campo = e.el.campo ? { el: e.el, inicial: e.valor } : undefined;
                break;
            case 'saiu':
                if (e.el.campo)
                    digitado(e.el, e.valor, e.teclas);
                if (campo && mesmo(campo.el, e.el))
                    campo = undefined;
                break;
            case 'tecla':
                if (e.el?.campo) {
                    digitado(e.el, e.valor, e.teclas ?? 0);
                    campo = { el: e.el, inicial: typeof e.valor === 'string' ? e.valor : null };
                }
                if (e.el)
                    empurrar({ tipo: 'janela.teclar', titulo: e.el.titulo, tecla: e.tecla });
                break;
            case 'gesto':
                naoGravados[e.gesto] = (naoGravados[e.gesto] ?? 0) + 1;
                break;
        }
    }
    return { acoes, momentos, semAlvo, naoGravados, foraDaGravacao };
}
const CODIGO_NATIVO = `
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;
using System.Web.Script.Serialization;

public static class SelfAutomateGravador {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static readonly TreeWalker Caminhante = TreeWalker.ControlViewWalker;
  const string CLICAVEL = "Button|MenuItem|ListItem|CheckBox|RadioButton|TabItem|Hyperlink|TreeItem|SplitButton";

  static AutomationElement Alvo(AutomationElement e) {
    // O ponto no meio de um botao cai no TEXTO dentro dele (medido em WPF, 09/10):
    // o alvo e o controle clicavel que o contem, nao o rotulo.
    var pai = Caminhante.GetParent(e);
    var tipo = e.Current.ControlType.ProgrammaticName;
    if (pai != null && (tipo.Contains("Text") || tipo.Contains("Image")) &&
        Regex.IsMatch(pai.Current.ControlType.ProgrammaticName, CLICAVEL)) return pai;
    return e;
  }

  public static Dictionary<string, object> Resolver(AutomationElement bruto) {
    if (bruto == null) return null;
    try {
      var e = Alvo(bruto);
      var raiz = AutomationElement.RootElement;
      var janela = e;
      while (true) {
        var p = Caminhante.GetParent(janela);
        if (p == null || Automation.Compare(p, raiz)) break;
        janela = p;
      }
      var c = e.Current;
      var tipo = c.ControlType.ProgrammaticName.Replace("ControlType.", "");
      bool campo = tipo == "Edit" || tipo == "Document";
      var d = new Dictionary<string, object>();
      d["titulo"] = janela.Current.Name ?? "";
      d["id"] = c.AutomationId ?? "";
      d["nome"] = c.Name ?? "";
      d["tipo"] = tipo == "Button" ? "botao" : (campo ? "campo" : tipo.ToLowerInvariant());
      d["campo"] = campo;
      d["senha"] = c.IsPassword;
      d["processo"] = c.ProcessId;
      try { d["programa"] = System.Diagnostics.Process.GetProcessById(c.ProcessId).ProcessName; } catch { }
      return d;
    } catch { return null; }
  }

  public static string ResolverPontoJson(double x, double y) {
    try {
      var r = Resolver(AutomationElement.FromPoint(new System.Windows.Point(x, y)));
      return r == null ? "null" : Json.Serialize(r);
    } catch { return "null"; }
  }

  static string LerValor(AutomationElement e) {
    try {
      if (e.Current.IsPassword) return null;
      object p;
      if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) return ((ValuePattern)p).Current.Value;
    } catch { }
    return null;
  }

  delegate IntPtr Proc(int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc f, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string nome);
  [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [StructLayout(LayoutKind.Sequential)] public struct PONTO { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public PONTO pt; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSE { public PONTO pt; public uint dados, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct TECLADO { public uint vk, scan, flags, time; public IntPtr extra; }

  static Proc procMouse, procTeclado;
  static readonly BlockingCollection<object[]> Fila = new BlockingCollection<object[]>();
  static AutomationElement focado;
  static int teclas;
  // G5c2: para reconhecer duplo clique e arrastar (o gancho so ve aperta e solta).
  static uint ultimoClique;
  static int ultimoX, ultimoY, baixoX, baixoY;
  static bool Apertada(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

  static void Emitir(Dictionary<string, object> d) {
    lock (Fila) { Console.Out.WriteLine(Json.Serialize(d)); Console.Out.Flush(); }
  }
  static Dictionary<string, object> Evento(string tipo) { var d = new Dictionary<string, object>(); d["tipo"] = tipo; return d; }

  // G5c2: o gesto que nao vira passo, pelo nome e sem valor.
  static void Gesto(string nome, AutomationElement el) {
    var d = Evento("gesto"); d["gesto"] = nome; d["el"] = el == null ? null : Resolver(el); Emitir(d);
  }

  static void FecharFocado() {
    if (focado == null) return;
    var r = Resolver(focado);
    if (r != null) { var d = Evento("saiu"); d["el"] = r; d["valor"] = LerValor(focado); d["teclas"] = teclas; Emitir(d); }
    focado = null;
    teclas = 0;
  }

  static void Trabalhar() {
    foreach (var ev in Fila.GetConsumingEnumerable()) {
      try {
        var tipo = (string)ev[0];
        if (tipo == "clique") {
          var bruto = AutomationElement.FromPoint(new System.Windows.Point((int)ev[1], (int)ev[2]));
          // Clique fora do campo em foco: o campo fecha ANTES do clique.
          if (focado != null && bruto != null && !Automation.Compare(Alvo(bruto), focado)) FecharFocado();
          var r = Resolver(bruto);
          if (r != null) { var d = Evento("clique"); d["el"] = r; Emitir(d); }
        } else if (tipo == "gesto") {
          Gesto((string)ev[1], AutomationElement.FromPoint(new System.Windows.Point((int)ev[2], (int)ev[3])));
        } else if (tipo == "foco") {
          var novo = ev[1] as AutomationElement;
          if (novo == null || (focado != null && Automation.Compare(novo, focado))) continue;
          FecharFocado();
          focado = novo;
          teclas = 0;
          var r = Resolver(novo);
          if (r != null) { var d = Evento("foco"); d["el"] = r; d["valor"] = LerValor(novo); Emitir(d); }
        } else if (tipo == "tecla") {
          int vk = (int)ev[1];
          bool ctrl = (bool)ev[2], alt = (bool)ev[3], altGr = (bool)ev[4];
          bool modificador = vk == 0x10 || vk == 0x11 || vk == 0x12 || (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C;
          if (vk >= 0x70 && vk <= 0x7B) { Gesto("teclaDeFuncao", focado); continue; }
          // Atalho: Ctrl ou Alt com outra tecla. Fora o AltGr (digita @ no teclado
          // brasileiro), o Ctrl+V (o colado entra pelo valor do campo) e o Alt+Tab.
          if ((ctrl || alt) && !altGr && !modificador && !(alt && vk == 0x09)) {
            if (ctrl && vk == 0x56) { teclas++; continue; }
            Gesto("atalho", focado);
            continue;
          }
          if (vk == 0x0D || vk == 0x1B) {
            var d = Evento("tecla");
            d["tecla"] = vk == 0x0D ? "ENTER" : "ESC";
            d["el"] = focado == null ? null : Resolver(focado);
            d["valor"] = focado == null ? null : LerValor(focado);
            d["teclas"] = teclas;
            Emitir(d);
            teclas = 0;
          } else teclas++;
        }
      } catch { }
    }
  }

  public static void Rodar() {
    new Thread(Trabalhar) { IsBackground = true }.Start();
    Automation.AddAutomationFocusChangedEventHandler((s, a) => Fila.Add(new object[] { "foco", s as AutomationElement }));
    procMouse = (n, w, l) => {
      int mensagem = (int)w;
      if (n >= 0 && (mensagem == 0x0201 || mensagem == 0x0202 || mensagem == 0x0204)) {
        var m = (MOUSE)Marshal.PtrToStructure(l, typeof(MOUSE));
        if (mensagem == 0x0201) {
          bool duplo = m.time - ultimoClique <= GetDoubleClickTime() && Math.Abs(m.pt.x - ultimoX) <= 4 && Math.Abs(m.pt.y - ultimoY) <= 4;
          ultimoClique = duplo ? 0 : m.time;
          ultimoX = baixoX = m.pt.x;
          ultimoY = baixoY = m.pt.y;
          Fila.Add(new object[] { "clique", m.pt.x, m.pt.y });
          if (duplo) Fila.Add(new object[] { "gesto", "duploClique", m.pt.x, m.pt.y });
        } else if (mensagem == 0x0204) {
          Fila.Add(new object[] { "gesto", "cliqueDireito", m.pt.x, m.pt.y });
        } else if (Math.Abs(m.pt.x - baixoX) > 10 || Math.Abs(m.pt.y - baixoY) > 10) {
          Fila.Add(new object[] { "gesto", "arrastar", baixoX, baixoY });
        }
      }
      return CallNextHookEx(IntPtr.Zero, n, w, l);
    };
    procTeclado = (n, w, l) => {
      if (n >= 0 && ((int)w == 0x0100 || (int)w == 0x0104)) {
        var k = (TECLADO)Marshal.PtrToStructure(l, typeof(TECLADO));
        // O estado dos modificadores e lido AQUI, no momento da tecla.
        Fila.Add(new object[] { "tecla", (int)k.vk, Apertada(0x11), Apertada(0x12), Apertada(0xA5) });
      }
      return CallNextHookEx(IntPtr.Zero, n, w, l);
    };
    var mod = GetModuleHandle(null);
    SetWindowsHookEx(14, procMouse, mod, 0);
    SetWindowsHookEx(13, procTeclado, mod, 0);
    Emitir(Evento("pronto"));
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
  }
}
`;
const CARREGAR_NATIVO = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions -TypeDefinition @'
${CODIGO_NATIVO}
'@
`;
type ElementoBruto = ElementoNaTela & {
    id: string;
    nome: string;
    processo?: number;
    programa?: string;
};
function doBruto(r: ElementoBruto): ElementoNaTela {
    const id = idEstavel(r.id);
    return {
        titulo: String(r.titulo ?? ''),
        ...(id ? { id } : {}),
        ...(r.nome ? { nome: String(r.nome) } : {}),
        tipo: String(r.tipo ?? ''),
        campo: r.campo === true,
        senha: r.senha === true,
        ...(typeof r.processo === 'number' ? { processo: r.processo } : {}),
        ...(typeof r.programa === 'string' && r.programa ? { programa: r.programa } : {}),
    };
}
export async function resolverPonto(x: number, y: number): Promise<ElementoNaTela | undefined> {
    const saida = await powershell(`${CARREGAR_NATIVO}\n[SelfAutomateGravador]::ResolverPontoJson(${Math.trunc(x)}, ${Math.trunc(y)})`);
    const r = JSON.parse(saida.trim() || 'null') as ElementoBruto | null;
    return r ? doBruto(r) : undefined;
}
function eventoDaLinha(linha: string): EventoDeJanela | undefined {
    let o: Record<string, unknown>;
    try {
        o = JSON.parse(linha) as Record<string, unknown>;
    }
    catch {
        return undefined;
    }
    const el = o.el && typeof o.el === 'object' ? doBruto(o.el as ElementoBruto) : null;
    const valor = typeof o.valor === 'string' ? o.valor : null;
    const teclas = typeof o.teclas === 'number' ? o.teclas : 0;
    switch (o.tipo) {
        case 'clique':
            return el ? { tipo: 'clique', el } : undefined;
        case 'foco':
            return el ? { tipo: 'foco', el, valor } : undefined;
        case 'saiu':
            return el ? { tipo: 'saiu', el, valor, teclas } : undefined;
        case 'tecla':
            return o.tecla === 'ENTER' || o.tecla === 'ESC' ? { tipo: 'tecla', tecla: o.tecla, el, valor, teclas } : undefined;
        case 'gesto':
            return ehGestoNaoGravado(o.gesto) ? { tipo: 'gesto', gesto: o.gesto, el } : undefined;
        default:
            return undefined;
    }
}
export interface GravacaoNoWindows {
    parar(): Promise<{
        acoes: AcaoGravada[];
        momentos: number[];
        semAlvo: number;
        naoGravados: NaoGravados;
        foraDaGravacao: number;
        eventos: number;
    }>;
}
export async function gravarNoWindows(o: {
    aoAtualizar?: (montada: {
        acoes: AcaoGravada[];
        momentos: number[];
        naoGravados: NaoGravados;
        foraDaGravacao: number;
    }) => void;
    aoBruto?: (linha: string) => void;
    ignorar?: (el: ElementoNaTela) => boolean;
    fora?: (el: ElementoNaTela) => boolean;
} = {}): Promise<GravacaoNoWindows> {
    const { spawn } = await import('node:child_process');
    const { createInterface } = await import('node:readline');
    const processo = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `${CARREGAR_NATIVO}\n[SelfAutomateGravador]::Rodar()`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    const eventos: EventoDeJanela[] = [];
    let erro = '';
    processo.stderr.on('data', (c: Buffer) => (erro += c.toString()));
    await new Promise<void>((pronto, falhou) => {
        const prazo = setTimeout(() => falhou(new Error(`os ganchos não ficaram prontos em 30 s${erro ? `: ${erro.slice(0, 300)}` : ''}`)), 30000);
        processo.once('exit', (codigo) => {
            clearTimeout(prazo);
            falhou(new Error(`o processo dos ganchos saiu (${codigo})${erro ? `: ${erro.slice(0, 300)}` : ''}`));
        });
        createInterface({ input: processo.stdout }).on('line', (linha) => {
            if (linha.includes('"tipo":"pronto"')) {
                clearTimeout(prazo);
                pronto();
                return;
            }
            o.aoBruto?.(linha);
            const e = eventoDaLinha(linha);
            if (!e)
                return;
            eventos.push({ ...e, em: Date.now() });
            o.aoAtualizar?.(montarAcoesDeJanela(eventos, o.ignorar, o.fora));
        });
    });
    return {
        parar: async () => {
            processo.removeAllListeners('exit');
            processo.kill();
            const m = montarAcoesDeJanela(eventos, o.ignorar, o.fora);
            return { ...m, eventos: eventos.length };
        },
    };
}
