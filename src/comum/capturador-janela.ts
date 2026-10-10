import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aspasPS, powershell } from '../blocos/powershell.js';
import { ehGestoNaoGravado, seletorPorId, seletorPorPapel, seletorPorTexto, type AcaoGravada, type AlvoNaJanela, type GestoNaoGravado, type NaoGravados, } from './gravacao.js';
export interface ElementoNaTela {
    titulo: string;
    id?: string;
    nome?: string;
    tipo: string;
    campo: boolean;
    senha: boolean;
    processo?: number;
    programa?: string;
    navegador?: boolean;
    web?: {
        categoria: 'A' | 'B' | 'C' | 'T' | 'D';
        papel?: string;
        nome?: string;
        id?: string;
        url: string;
        quadros: number;
        estrategia?: string;
    };
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
} | {
    tipo: 'baixou';
    el?: undefined;
    pasta: string;
    nome: string;
    viaDialogo: boolean;
    renomeou?: boolean;
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
const mesmo = (a: ElementoNaTela, b: ElementoNaTela): boolean => a.titulo === b.titulo &&
    (a.id ?? '') === (b.id ?? '') &&
    (a.nome ?? '') === (b.nome ?? '') &&
    (a.web?.papel ?? '') === (b.web?.papel ?? '') &&
    (a.web?.nome ?? '') === (b.web?.nome ?? '') &&
    (a.web?.id ?? '') === (b.web?.id ?? '');
function seletorWeb(w: NonNullable<ElementoNaTela['web']>): string | undefined {
    if ((w.categoria === 'A' || w.categoria === 'C') && w.papel && w.nome)
        return seletorPorPapel(w.papel, w.nome);
    if (w.categoria === 'B' && w.id)
        return seletorPorId(w.id);
    if (w.categoria === 'T' && w.nome)
        return seletorPorTexto(w.nome);
    return undefined;
}
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
    let paginaAtual: string | undefined;
    let mudouPorDentro = false;
    const naPagina = (el: ElementoNaTela): string | undefined => {
        const w = el.web!;
        if (w.quadros > 1) {
            naoGravados.iframe = (naoGravados.iframe ?? 0) + 1;
            return undefined;
        }
        const seletor = seletorWeb(w);
        if (!seletor || !/^https?:\/\//i.test(w.url)) {
            semAlvo++;
            return undefined;
        }
        if (w.url !== paginaAtual) {
            if (!mudouPorDentro)
                empurrar({ tipo: 'web.abrir', url: w.url });
            paginaAtual = w.url;
        }
        return seletor;
    };
    const digitado = (el: ElementoNaTela, valor: string | null | undefined, teclas: number): void => {
        if (el.web) {
            const inicialWeb = campo && mesmo(campo.el, el) ? campo.inicial : null;
            const mudou = el.senha ? teclas > 0 : typeof valor === 'string' && valor !== inicialWeb;
            if (!mudou)
                return;
            const seletor = naPagina(el);
            if (!seletor)
                return;
            empurrar(el.senha ? { tipo: 'web.preencherSegredo', seletor } : { tipo: 'web.preencher', seletor, valor: valor as string });
            mudouPorDentro = false;
            return;
        }
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
    const baixados = new Map<string, {
        em: number;
        k: number;
        viaDialogo: boolean;
    }>();
    for (const [i, e] of eventos.entries()) {
        if (e.tipo === 'baixou') {
            quando = e.em ?? i;
            const ja = baixados.get(e.nome.toLowerCase());
            if (ja && quando - ja.em < 60000) {
                const feito = acoes[ja.k];
                if (e.viaDialogo && !ja.viaDialogo && feito?.tipo === 'web.baixar') {
                    acoes[ja.k] = { ...feito, pasta: e.pasta, ...(e.renomeou ? { nome: e.nome } : {}) };
                    ja.viaDialogo = true;
                }
                continue;
            }
            const k = acoes.length - 1;
            const ultimo = acoes[k];
            if (!ultimo || ultimo.tipo !== 'web.clicar' || quando - (momentos[k] ?? 0) > 30000)
                continue;
            acoes[k] = {
                tipo: 'web.baixar',
                seletor: ultimo.seletor,
                arquivo: e.nome,
                ...(e.viaDialogo ? { pasta: e.pasta } : {}),
                ...(e.viaDialogo && e.renomeou ? { nome: e.nome } : {}),
            };
            baixados.set(e.nome.toLowerCase(), { em: quando, k, viaDialogo: e.viaDialogo });
            continue;
        }
        if (ignorar && e.el && ignorar(e.el))
            continue;
        if (fora && e.el && fora(e.el)) {
            if (e.tipo === 'clique')
                foraDaGravacao++;
            continue;
        }
        quando = e.em ?? i;
        if (e.el?.navegador && !e.el.web) {
            mudouPorDentro = false;
            continue;
        }
        switch (e.tipo) {
            case 'clique': {
                if (e.el.campo)
                    break;
                if (e.el.web) {
                    const seletor = naPagina(e.el);
                    if (seletor) {
                        empurrar({ tipo: 'web.clicar', seletor });
                        mudouPorDentro = true;
                    }
                    break;
                }
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
                if (e.el?.web) {
                    if (naPagina(e.el)) {
                        empurrar({ tipo: 'web.teclar', tecla: e.tecla });
                        mudouPorDentro = true;
                    }
                }
                else if (e.el)
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
using System.Text;
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

  public static Dictionary<string, object> Resolver(AutomationElement bruto) { return Resolver(bruto, true); }
  // comWeb: num navegador, ja poe a identidade web do proprio elemento (foco,
  // campo, tecla). O clique a escolhe pela regra do banco de prova, e pede sem.
  public static Dictionary<string, object> Resolver(AutomationElement bruto, bool comWeb) {
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
      if (EhNavegador(d)) {
        if (comWeb) MarcarWeb(d, IdentidadeWeb(e));
        else d["navegador"] = true;
      }
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

  /*
   * 0164 (10/10/2026): A SESSAO INTEIRA. O clique no Chrome DA PESSOA e
   * identificado aqui, pela UI Automation: papel ARIA e nome. Medido no banco de
   * prova (ferramentas/rodar-banco-de-prova.mts): a consulta POR PONTO falha logo
   * depois de a pagina mudar, a ARVORE esta certa. A regra escolhida, 94% (o sistema real   * medido: 100%): alvo CLICAVEL primeiro; entre os candidatos, rastro, arvore,
   * consulta no clique, foco; sem nenhum clicavel, repetida e gatilho.
   */
  static readonly System.Reflection.FieldInfo NO = typeof(AutomationElement).GetField("_hnode", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
  [DllImport("UIAutomationCore.dll")] static extern int UiaGetPropertyValue(IntPtr hnode, int propertyId, [MarshalAs(UnmanagedType.Struct)] out object valor);
  // O cliente UIA do .NET so conhece as propriedades do Windows 7: AriaRole (30101)
  // nao existe nele (medido em 10/10). Le pela UIA nativa, com o no do elemento.
  static string Aria(AutomationElement e) {
    try { object v; return UiaGetPropertyValue(((SafeHandle)NO.GetValue(e)).DangerousGetHandle(), 30101, out v) == 0 ? (v as string ?? "") : ""; } catch { return ""; }
  }
  static readonly HashSet<string> SEM_ALVO = new HashSet<string> {
    "", "generic", "none", "presentation", "group", "paragraph", "document", "main", "region", "navigation",
    "banner", "contentinfo", "form", "article", "section", "complementary", "application", "rootwebarea",
    "statictext", "inlinetextbox", "linebreak", "description", "figure", "list", "table", "rowgroup", "toolbar", "menubar", "tablist"
  };
  static readonly HashSet<string> CLICAVEIS = new HashSet<string> {
    "button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "tab", "checkbox", "radio", "switch",
    "textbox", "searchbox", "combobox", "slider", "spinbutton", "treeitem"
  };
  static readonly HashSet<string> NAVEGADORES = new HashSet<string> { "chrome", "msedge", "brave", "vivaldi", "opera" };
  static string TipoDe(AutomationElement e) { try { return e.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""); } catch { return ""; } }
  static string NomeDe(AutomationElement e) { try { return (e.Current.Name ?? "").Trim(); } catch { return ""; } }
  static string IdDe(AutomationElement e) { try { return e.Current.AutomationId ?? ""; } catch { return ""; } }
  static bool IdWebEstavel(string id) {
    if (string.IsNullOrEmpty(id) || id == "RootWebArea") return false;
    return !Regex.IsMatch(id, "^:r[0-9a-z]*:$|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}|[0-9]{4,}|^(ember|mui-|radix-|react-|headlessui-)");
  }
  // O nome vai INTEIRO para o seletor (ate o teto da gravacao): cortado, deixaria de
  // casar no replay (revisao independente da 0164, 10/10). A tela corta sozinha.
  static string Corte(string s) { return s.Length > 2000 ? s.Substring(0, 2000) : s; }

  public class Web { public string categoria = "D", papel = "", nome = "", id = "", url = "", estrategia = ""; public int quadros; public System.Windows.Rect ret = System.Windows.Rect.Empty; }
  static bool Bom(Web w) { return w != null && w.categoria != "D"; }
  static bool Clicavel(Web w) { return Bom(w) && CLICAVEIS.Contains(w.papel); }

  // A identidade web de um elemento: sobe ate o documento; a regra A/C/B/T/D do
  // banco de prova. Nulo se o elemento nao esta numa pagina.
  static Web IdentidadeWeb(AutomationElement e) {
    if (e == null) return null;
    try {
      var cadeia = new List<AutomationElement>();
      AutomationElement docDentro = null, docTopo = null;
      int docs = 0;
      var raiz = AutomationElement.RootElement;
      for (var a = e; a != null && cadeia.Count < 40; ) {
        cadeia.Add(a);
        if (TipoDe(a) == "Document") { docs++; if (docDentro == null) docDentro = a; docTopo = a; }
        var p = Caminhante.GetParent(a);
        if (p == null || Automation.Compare(p, raiz)) break;
        a = p;
      }
      if (docDentro == null) return null;
      var w = new Web();
      w.quadros = docs;
      try { object vp; if (docTopo.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) w.url = ((ValuePattern)vp).Current.Value ?? ""; } catch { }
      AutomationElement alvo = e;
      if (TipoDe(e) == "Document") { }
      else if (!SEM_ALVO.Contains(Aria(e).ToLowerInvariant()) && NomeDe(e) != "") { w.categoria = "A"; w.papel = Aria(e); w.nome = NomeDe(e); }
      else {
        for (int i = 1; i <= 4 && i < cadeia.Count; i++) {
          if (TipoDe(cadeia[i]) == "Document") break;
          if (!SEM_ALVO.Contains(Aria(cadeia[i]).ToLowerInvariant()) && NomeDe(cadeia[i]) != "") { w.categoria = "C"; w.papel = Aria(cadeia[i]); w.nome = NomeDe(cadeia[i]); alvo = cadeia[i]; break; }
        }
        if (w.categoria == "D") {
          if (IdWebEstavel(IdDe(e))) { w.categoria = "B"; w.id = IdDe(e); }
          else if (NomeDe(e) != "") { w.categoria = "T"; w.nome = NomeDe(e); }
        }
      }
      w.nome = Corte(w.nome);
      try { w.ret = alvo.Current.BoundingRectangle; } catch { }
      return w;
    } catch { return null; }
  }
  static bool Cobre(Web w, int x, int y) {
    return w != null && !w.ret.IsEmpty && x >= w.ret.Left - 1 && x <= w.ret.Right + 1 && y >= w.ret.Top - 1 && y <= w.ret.Bottom + 1;
  }

  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PONTO p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  // A ARVORE: da janela sob o ponto, desce escolhendo o ULTIMO filho que contem o
  // ponto (o ultimo desenhado fica por cima: os menus do Radix vao para o fim).
  static Web PelaArvore(int x, int y) {
    try {
      var pt = new PONTO(); pt.x = x; pt.y = y;
      var topo = GetAncestor(WindowFromPoint(pt), 2);
      if (topo == IntPtr.Zero) return null;
      var atual = AutomationElement.FromHandle(topo);
      var relogio = System.Diagnostics.Stopwatch.StartNew();
      for (int nivel = 0; nivel < 80 && relogio.ElapsedMilliseconds < 800; nivel++) {
        AutomationElement escolhido = null;
        int irmaos = 0;
        for (var f = Caminhante.GetFirstChild(atual); f != null && irmaos < 600; f = Caminhante.GetNextSibling(f), irmaos++) {
          System.Windows.Rect r;
          try { r = f.Current.BoundingRectangle; } catch { continue; }
          if (!r.IsEmpty && x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom) escolhido = f;
        }
        if (escolhido == null) break;
        atual = escolhido;
      }
      return IdentidadeWeb(atual);
    } catch { return null; }
  }
  // O FOCO, se cobre o ponto e tem papel com alvo (o Radix foca o item sob o mouse).
  static Web PeloFoco(int x, int y) {
    try { var w = IdentidadeWeb(AutomationElement.FocusedElement); return w != null && (w.categoria == "A" || w.categoria == "C") && Cobre(w, x, y) ? w : null; } catch { return null; }
  }
  // O GATILHO: o foco foi para um menu ou lista COM NOME (o Radix da ao menu o nome
  // do botao que o abre) e o ponto ficou fora dele: o clique foi nesse botao.
  static Web Gatilho(int x, int y) {
    try {
      var a = AutomationElement.FocusedElement;
      for (int i = 0; a != null && i < 12; i++) {
        var papel = Aria(a);
        if ((papel == "menu" || papel == "listbox") && NomeDe(a) != "") {
          var r = a.Current.BoundingRectangle;
          if (!r.IsEmpty && x >= r.Left && x <= r.Right && y >= r.Top && y <= r.Bottom) return null;
          var w = IdentidadeWeb(a);
          if (w == null) return null;
          w.categoria = "A"; w.papel = papel == "menu" ? "button" : "combobox"; w.nome = Corte(NomeDe(a)); w.ret = System.Windows.Rect.Empty;
          return w;
        }
        if (TipoDe(a) == "Document") break;
        a = Caminhante.GetParent(a);
      }
    } catch { }
    return null;
  }

  // O RASTRO: o mouse MEXENDO e medido sem esperar parar (no maximo a cada 60 ms).
  // Alem de acertar sozinho, mantem a resposta do Chrome atualizada (a consulta no
  // clique subiu de 63% para 84% com ele, no banco de prova).
  static volatile int movX = -999, movY = -999;
  static readonly object TravaDoRastro = new object();
  static Web rastro;
  static long rastroEm = -1;
  static IntPtr rastroJanela = IntPtr.Zero;
  static readonly System.Diagnostics.Stopwatch Relogio = System.Diagnostics.Stopwatch.StartNew();
  static void Rastrear() {
    int rx = -999, ry = -999;
    while (true) {
      Thread.Sleep(60);
      int x = movX, y = movY;
      if (Math.Abs(x - rx) <= 3 && Math.Abs(y - ry) <= 3) continue;
      rx = x; ry = y;
      try {
        var pt = new PONTO(); pt.x = x; pt.y = y;
        var janela = GetAncestor(WindowFromPoint(pt), 2);
        var e = AutomationElement.FromPoint(new System.Windows.Point(x, y));
        string prog = "";
        try { prog = System.Diagnostics.Process.GetProcessById(e.Current.ProcessId).ProcessName.ToLowerInvariant(); } catch { }
        if (!NAVEGADORES.Contains(prog)) continue;
        var w = IdentidadeWeb(e);
        // A hora do FIM da consulta: so vale o que foi lido INTEIRO antes do clique
        // (a do inicio deixava passar uma leitura que terminou depois dele).
        long fim = Relogio.ElapsedMilliseconds;
        lock (TravaDoRastro) { rastro = w; rastroEm = fim; rastroJanela = janela; }
      } catch { }
    }
  }

  // O clique numa pagina: a regra medida.
  static Web EscolherNoClique(int x, int y, long clicouEm, AutomationElement bruto) {
    var candidatos = new List<KeyValuePair<string, Web>>();
    Web ras; long rasEm; IntPtr rasJanela;
    lock (TravaDoRastro) { ras = rastro; rasEm = rastroEm; rasJanela = rastroJanela; }
    // O rastro so vale da MESMA janela que esta sob o ponto do clique: outra aba ou
    // um popup no mesmo lugar nao herdam a identidade (revisao independente, 10/10).
    var noClique = new PONTO(); noClique.x = x; noClique.y = y;
    bool mesmaJanela = rasJanela != IntPtr.Zero && GetAncestor(WindowFromPoint(noClique), 2) == rasJanela;
    if (ras != null && rasEm >= 0 && rasEm <= clicouEm && clicouEm - rasEm < 1500 && mesmaJanela && Cobre(ras, x, y)) candidatos.Add(new KeyValuePair<string, Web>("rastro", ras));
    candidatos.Add(new KeyValuePair<string, Web>("arvore", PelaArvore(x, y)));
    candidatos.Add(new KeyValuePair<string, Web>("clique", bruto == null ? null : IdentidadeWeb(Alvo(bruto))));
    candidatos.Add(new KeyValuePair<string, Web>("foco", PeloFoco(x, y)));
    bool algumClicavel = false;
    foreach (var c in candidatos) if (Clicavel(c.Value)) algumClicavel = true;
    if (!algumClicavel) {
      Thread.Sleep(100);
      Web repetida = null;
      try { repetida = IdentidadeWeb(AutomationElement.FromPoint(new System.Windows.Point(x, y))); } catch { }
      candidatos.Add(new KeyValuePair<string, Web>("repetida", repetida));
      candidatos.Add(new KeyValuePair<string, Web>("gatilho", Gatilho(x, y)));
    }
    Web escolhida = null;
    foreach (var c in candidatos) if (Clicavel(c.Value)) { escolhida = c.Value; escolhida.estrategia = c.Key; break; }
    if (escolhida == null) foreach (var c in candidatos) if (Bom(c.Value)) { escolhida = c.Value; escolhida.estrategia = c.Key; break; }
    if (escolhida == null) foreach (var c in candidatos) if (c.Value != null) { escolhida = c.Value; escolhida.estrategia = "nenhuma"; break; }
    return escolhida;
  }
  static Dictionary<string, object> WebDict(Web w) {
    var d = new Dictionary<string, object>();
    d["categoria"] = w.categoria; d["papel"] = w.papel; d["nome"] = w.nome; d["id"] = w.id; d["url"] = w.url; d["quadros"] = w.quadros;
    if (w.estrategia != "") d["estrategia"] = w.estrategia;
    return d;
  }
  // Marca o elemento como de navegador e, se estiver numa pagina, poe a identidade
  // web; o campo e o que a pagina diz que e campo (o documento nao e).
  static void MarcarWeb(Dictionary<string, object> r, Web w) {
    r["navegador"] = true;
    if (w == null) return;
    r["web"] = WebDict(w);
    r["campo"] = w.papel == "textbox" || w.papel == "searchbox";
    if (w.nome != "") r["nome"] = w.nome;
  }
  // O Chrome manda um SEGUNDO aviso de foco, para o texto DENTRO do campo, e e ele
  // que recebe a digitacao (medido em 10/10 com o mouse real: o valor "fatura" saia
  // de um elemento sem papel). O foco num elemento interno sobe ate o campo que o
  // contem; o segundo aviso vira o mesmo campo e e ignorado.
  static readonly HashSet<string> CAMPOS = new HashSet<string> { "textbox", "searchbox", "combobox" };
  static AutomationElement SubirAoCampo(AutomationElement e) {
    if (e == null) return null;
    try {
      if (CAMPOS.Contains(Aria(e))) return e;
      // O objeto que vem NO AVISO de foco pode nao responder o papel (medido: o
      // mesmo campo, lido pelo aviso, sem papel; lido de novo, textbox). Num
      // navegador, pergunta de novo quem esta em foco agora.
      if (Aria(e) == "") {
        try {
          string prog = System.Diagnostics.Process.GetProcessById(e.Current.ProcessId).ProcessName.ToLowerInvariant();
          var agora = NAVEGADORES.Contains(prog) ? AutomationElement.FocusedElement : null;
          if (agora != null && agora.Current.ProcessId == e.Current.ProcessId && CAMPOS.Contains(Aria(agora))) return agora;
        } catch { }
      }
      var a = Caminhante.GetParent(e);
      for (int i = 0; a != null && i < 3; i++) {
        if (CAMPOS.Contains(Aria(a))) return a;
        if (TipoDe(a) == "Document") break;
        a = Caminhante.GetParent(a);
      }
    } catch { }
    return e;
  }
  /*
   * 0164 C2 (10/10/2026): O DOWNLOAD. No robo o download e do Playwright: o passo e
   * UM, navegador.baixar. O agente o ve por duas portas:
   *  - o "Salvar como" do navegador: enquanto aberto, a pasta (barra de endereco,
   *    "Endereco: C:\..." - medido) e o nome (o campo 1001) sao lidos e guardados a
   *    cada evento - ele pode fechar antes de a fila chegar ao clique em Salvar. No
   *    Salvar (botao 1) ou no Enter, a pasta e vigiada ate o arquivo final aparecer;
   *  - sem dialogo (o padrao do Chrome): a pasta Downloads, a gravacao inteira.
   */
  [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr caminho);
  static string PastaDownloads() {
    try {
      IntPtr p;
      if (SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"), 0, IntPtr.Zero, out p) != 0) return null;
      var s = Marshal.PtrToStringUni(p); Marshal.FreeCoTaskMem(p); return s;
    } catch { return null; }
  }
  static bool Temporario(string nome) {
    var n = (nome ?? "").ToLowerInvariant();
    return n == "" || n.EndsWith(".crdownload") || n.EndsWith(".tmp") || n.EndsWith(".partial") || n.EndsWith(".download") || n.StartsWith("~$") || n.StartsWith(".com.google") || n == "desktop.ini";
  }
  static System.IO.FileSystemWatcher vigiaDownloads;
  static void VigiarDownloads() {
    try {
      var p = PastaDownloads();
      if (p == null || !System.IO.Directory.Exists(p)) return;
      vigiaDownloads = new System.IO.FileSystemWatcher(p);
      vigiaDownloads.NotifyFilter = System.IO.NotifyFilters.FileName;
      vigiaDownloads.Created += (s, a) => { if (!Temporario(a.Name)) Fila.Add(new object[] { "baixou", p, a.Name, false, false }); };
      vigiaDownloads.Renamed += (s, a) => { if (!Temporario(a.Name)) Fila.Add(new object[] { "baixou", p, a.Name, false, false }); };
      vigiaDownloads.EnableRaisingEvents = true;
    } catch { }
  }

  static AutomationElement JanelaDe(AutomationElement e) {
    try {
      var raiz = AutomationElement.RootElement;
      var j = e;
      for (int i = 0; j != null && i < 60; i++) {
        var p = Caminhante.GetParent(j);
        if (p == null || Automation.Compare(p, raiz)) return j;
        j = p;
      }
    } catch { }
    return null;
  }
  class Dialogo { public int hwnd; public string pasta, nome, inicial; }
  static Dialogo dialogo;
  // Le o "Salvar como" de um NAVEGADOR: a pasta pela barra de endereco, o nome pelo
  // campo 1001 (que pode trazer um caminho inteiro, se a pessoa o digitou).
  // Na arvore da UIA o "Salvar como" e FILHO da janela do Chrome (medido em
  // 10/10): o dialogo e o ancestral de classe #32770, nao a janela de cima.
  static AutomationElement DialogoDe(AutomationElement e) {
    try {
      var raiz = AutomationElement.RootElement;
      for (var a = e; a != null && !Automation.Compare(a, raiz); a = Caminhante.GetParent(a)) if (a.Current.ClassName == "#32770") return a;
    } catch { }
    return null;
  }
  // O TEXTO do campo do nome, pelo Windows (WM_GETTEXT na caixa Edit de id 1001):
  // pela acessibilidade, dentro dos ganchos, vinha o ROTULO "Nome:" (medido em 10/10).
  delegate bool AoFilho(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr pai, AoFilho f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  static string TextoDoCampoNome(IntPtr dialogo) {
    string achado = null;
    try {
      EnumChildWindows(dialogo, (h, l) => {
        var c = new StringBuilder(64);
        GetClassName(h, c, 64);
        if (c.ToString() == "Edit" && GetDlgCtrlID(h) == 1001) {
          var t = new StringBuilder(2048);
          SendMessage(h, 0x000D, new IntPtr(2048), t);
          achado = t.ToString();
          return false;
        }
        return true;
      }, IntPtr.Zero);
    } catch { }
    return achado;
  }
  static bool AtualizarDialogo(AutomationElement e) {
    if (e == null) return false;
    try {
      var j = DialogoDe(e);
      if (j == null) return false;
      string prog = "";
      try { prog = System.Diagnostics.Process.GetProcessById(j.Current.ProcessId).ProcessName.ToLowerInvariant(); } catch { }
      if (!NAVEGADORES.Contains(prog)) return false;
      var end = j.FindFirst(TreeScope.Descendants, new AndCondition(new PropertyCondition(AutomationElement.ClassNameProperty, "ToolbarWindow32"), new PropertyCondition(AutomationElement.AutomationIdProperty, "1001")));
      if (end == null) return false;
      var rotulo = end.Current.Name ?? "";
      int k = rotulo.IndexOf(": ");
      var pasta = k >= 0 ? rotulo.Substring(k + 2).Trim() : "";
      int hj = j.Current.NativeWindowHandle;
      var nome = (TextoDoCampoNome(new IntPtr(hj)) ?? "").Trim();
      if (nome.Length > 2 && (nome[1] == ':' || nome.StartsWith(new string((char)92, 2)))) { pasta = System.IO.Path.GetDirectoryName(nome); nome = System.IO.Path.GetFileName(nome); }
      if (nome == "") return false;
      int h = hj;
      if (dialogo == null || dialogo.hwnd != h) dialogo = new Dialogo { hwnd = h, inicial = nome };
      dialogo.pasta = pasta; dialogo.nome = nome;
      return true;
    } catch { return false; }
  }
  // O foco esta no dialogo? Guardado NA HORA do foco: no Enter o dialogo ja fechou
  // (medido em 10/10), e o elemento em foco ja nao responde.
  static bool focadoNoDialogo;
  static bool NoDialogo(AutomationElement e) {
    if (dialogo == null || e == null) return false;
    try { var j = DialogoDe(e); return j != null && j.Current.NativeWindowHandle == dialogo.hwnd; } catch { return false; }
  }
  // A barra de endereco do Chrome diz "Downloads" (o nome de exibicao), e nao o
  // caminho (medido em 10/10). Sem caminho absoluto, o arquivo e procurado nas
  // pastas conhecidas da pessoa.
  static List<string> PastasCandidatas(string pasta) {
    var r = new List<string>();
    if (pasta != null && pasta.Length > 2 && (pasta[1] == ':' || pasta.StartsWith(new string((char)92, 2)))) { r.Add(pasta); return r; }
    var d = PastaDownloads(); if (d != null) r.Add(d);
    try { r.Add(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)); } catch { }
    try { r.Add(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)); } catch { }
    try { r.Add(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)); } catch { }
    return r;
  }
  // Salvar: vigia a pasta ate o arquivo FINAL aparecer (o .crdownload nao conta).
  static void Salvou() {
    var d = dialogo;
    dialogo = null;
    if (d == null) return;
    // Sem a extensao: o campo mostra o nome sugerido SEM ela (o Windows esconde
    // extensao), e o mesmo nome digitado com ".csv" nao e um nome novo (medido em 10/10).
    bool renomeou = !string.Equals(System.IO.Path.GetFileNameWithoutExtension(d.inicial), System.IO.Path.GetFileNameWithoutExtension(d.nome), StringComparison.OrdinalIgnoreCase);
    var inicio = DateTime.Now.AddSeconds(-5);
    new Thread(() => {
      try {
        var limite = DateTime.Now.AddSeconds(60);
        var candidatas = PastasCandidatas(d.pasta);
        while (DateTime.Now < limite) {
          Thread.Sleep(400);
          foreach (var p in candidatas) {
            if (!System.IO.Directory.Exists(p)) continue;
            foreach (var f in new System.IO.DirectoryInfo(p).GetFiles(d.nome + "*")) {
              if (Temporario(f.Name) || f.LastWriteTime < inicio) continue;
              Fila.Add(new object[] { "baixou", p, f.Name, true, renomeou });
              return;
            }
          }
        }
      } catch { }
    }) { IsBackground = true }.Start();
  }

  static bool EhNavegador(Dictionary<string, object> r) {
    object p;
    return r != null && r.TryGetValue("programa", out p) && p is string && NAVEGADORES.Contains(((string)p).ToLowerInvariant());
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
        // PARAR (revisao independente, 10/10): o processo era morto, e o campo em
        // foco - o ultimo preenchimento - se perdia. Agora o pedido entra na FILA:
        // o que veio antes dele e tratado, o campo fecha, e a resposta e "fim".
        if (tipo == "parar") { FecharFocado(); Emitir(Evento("fim")); continue; }
        if (tipo == "baixou") {
          var b = Evento("baixou"); b["pasta"] = ev[1]; b["nome"] = ev[2]; b["viaDialogo"] = ev[3]; b["renomeou"] = ev[4];
          Emitir(b);
          continue;
        }
        if (tipo == "clique") {
          int cx = (int)ev[1], cy = (int)ev[2];
          long clicouEm = ev.Length > 3 ? (long)ev[3] : Relogio.ElapsedMilliseconds;
          var bruto = AutomationElement.FromPoint(new System.Windows.Point(cx, cy));
          // C2: o "Salvar como" do navegador e lido a cada evento; o clique em Salvar
          // (o botao 1 dele) dispara a espera pelo arquivo.
          AtualizarDialogo(bruto);
          if (bruto != null && NoDialogo(bruto)) {
            var ab = Alvo(bruto);
            if (TipoDe(ab) == "Button" && IdDe(ab) == "1") Salvou();
          }
          // Clique fora do campo em foco: o campo fecha ANTES do clique.
          if (focado != null && bruto != null && !Automation.Compare(Alvo(bruto), focado)) FecharFocado();
          var r = Resolver(bruto, false);
          // 0164: num navegador, a identidade e escolhida pela regra do banco de prova.
          if (r != null && EhNavegador(r)) MarcarWeb(r, EscolherNoClique(cx, cy, clicouEm, bruto));
          if (r != null) { var d = Evento("clique"); d["el"] = r; Emitir(d); }
        } else if (tipo == "gesto") {
          Gesto((string)ev[1], AutomationElement.FromPoint(new System.Windows.Point((int)ev[2], (int)ev[3])));
        } else if (tipo == "foco") {
          var novo = SubirAoCampo(ev[1] as AutomationElement);
          focadoNoDialogo = AtualizarDialogo(novo);
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
          // C2: no "Salvar como", cada tecla relê o nome; o Enter salva.
          // A marca acende tambem aqui: no aviso de foco o campo ainda estava vazio, e a
          // leitura falhava (medido em 10/10 - o Enter nao salvava).
          if (focado != null && vk != 0x1B && AtualizarDialogo(focado)) focadoNoDialogo = true;
          // O Enter salva se o "Salvar como" lido estava NA FRENTE na hora da tecla. A
          // marca do foco nao basta: digitando um caminho, a lista de sugestoes do
          // dialogo leva o foco e a apaga (medido em 10/10).
          long frente = ev.Length > 5 ? (long)ev[5] : 0;
          if (vk == 0x0D && (focadoNoDialogo || (dialogo != null && frente == dialogo.hwnd))) { focadoNoDialogo = false; Salvou(); }
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

  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  public static void Rodar() {
    // Os ganchos dao pixels FISICOS; a UI Automation so os entende assim com o
    // processo DPI por monitor (a pesquisa da 0164: fora de 96 DPI, erra o ponto).
    bool dpi = false;
    try { dpi = SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    new Thread(Trabalhar) { IsBackground = true }.Start();
    new Thread(Rastrear) { IsBackground = true }.Start();
    VigiarDownloads();
    new Thread(() => {
      string linha;
      while ((linha = Console.In.ReadLine()) != null) if (linha.Trim() == "parar") Fila.Add(new object[] { "parar" });
    }) { IsBackground = true }.Start();
    Automation.AddAutomationFocusChangedEventHandler((s, a) => Fila.Add(new object[] { "foco", s as AutomationElement }));
    procMouse = (n, w, l) => {
      int mensagem = (int)w;
      if (n >= 0 && mensagem == 0x0200) {
        // 0164: o rastro precisa de onde o mouse anda; so guarda o ponto.
        var mv = (MOUSE)Marshal.PtrToStructure(l, typeof(MOUSE));
        movX = mv.pt.x; movY = mv.pt.y;
      } else if (n >= 0 && (mensagem == 0x0201 || mensagem == 0x0202 || mensagem == 0x0204)) {
        var m = (MOUSE)Marshal.PtrToStructure(l, typeof(MOUSE));
        if (mensagem == 0x0201) {
          bool duplo = m.time - ultimoClique <= GetDoubleClickTime() && Math.Abs(m.pt.x - ultimoX) <= 4 && Math.Abs(m.pt.y - ultimoY) <= 4;
          ultimoClique = duplo ? 0 : m.time;
          ultimoX = baixoX = m.pt.x;
          ultimoY = baixoY = m.pt.y;
          Fila.Add(new object[] { "clique", m.pt.x, m.pt.y, Relogio.ElapsedMilliseconds });
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
        // C2: a janela da FRENTE no instante da tecla - no Enter o "Salvar como" fecha
        // antes de a fila chegar, e so este instante sabe que era ele.
        Fila.Add(new object[] { "tecla", (int)k.vk, Apertada(0x11), Apertada(0x12), Apertada(0xA5), GetForegroundWindow().ToInt64() });
      }
      return CallNextHookEx(IntPtr.Zero, n, w, l);
    };
    var mod = GetModuleHandle(null);
    SetWindowsHookEx(14, procMouse, mod, 0);
    SetWindowsHookEx(13, procTeclado, mod, 0);
    // O que pode falhar calado, dito no inicio: DPI por monitor e a leitura do papel
    // ARIA (reflexao num campo interno do .NET).
    var pronto = Evento("pronto"); pronto["dpiPorMonitor"] = dpi; pronto["papelAria"] = NO != null;
    Emitir(pronto);
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
  }
}
`;
let fonteDoNativo: string | undefined;
function carregarNativo(): string {
    if (!fonteDoNativo || !existsSync(fonteDoNativo)) {
        const hash = createHash('sha256').update(CODIGO_NATIVO).digest('hex').slice(0, 16);
        const pasta = join(tmpdir(), 'selfautomate-gravador');
        mkdirSync(pasta, { recursive: true });
        fonteDoNativo = join(pasta, `gravador-${hash}.cs`);
        if (!existsSync(fonteDoNativo))
            writeFileSync(fonteDoNativo, CODIGO_NATIVO, 'utf8');
    }
    return `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, System.Web.Extensions -Path ${aspasPS(fonteDoNativo)}
`;
}
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
        ...(r.navegador === true ? { navegador: true } : {}),
        ...(webDoBruto(r.web) ? { web: webDoBruto(r.web)! } : {}),
    };
}
function webDoBruto(w: unknown): ElementoNaTela['web'] | undefined {
    if (!w || typeof w !== 'object')
        return undefined;
    const o = w as Record<string, unknown>;
    const categoria = ['A', 'B', 'C', 'T', 'D'].includes(String(o.categoria)) ? (String(o.categoria) as 'A' | 'B' | 'C' | 'T' | 'D') : 'D';
    const texto = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const papel = texto(o.papel);
    const nome = texto(o.nome);
    const id = texto(o.id);
    const estrategia = texto(o.estrategia);
    return {
        categoria,
        ...(papel ? { papel } : {}),
        ...(nome ? { nome } : {}),
        ...(id ? { id } : {}),
        url: typeof o.url === 'string' ? o.url : '',
        quadros: typeof o.quadros === 'number' ? o.quadros : 1,
        ...(estrategia ? { estrategia } : {}),
    };
}
export async function resolverPonto(x: number, y: number): Promise<ElementoNaTela | undefined> {
    const saida = await powershell(`${carregarNativo()}\n[SelfAutomateGravador]::ResolverPontoJson(${Math.trunc(x)}, ${Math.trunc(y)})`);
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
        case 'baixou':
            return typeof o.pasta === 'string' && typeof o.nome === 'string' && o.pasta && o.nome
                ? { tipo: 'baixou', pasta: o.pasta, nome: o.nome, viaDialogo: o.viaDialogo === true, renomeou: o.renomeou === true }
                : undefined;
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
    aoAviso?: (linha: string) => void;
    ignorar?: (el: ElementoNaTela) => boolean;
    fora?: (el: ElementoNaTela) => boolean;
} = {}): Promise<GravacaoNoWindows> {
    const { spawn } = await import('node:child_process');
    const { createInterface } = await import('node:readline');
    const processo = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `${carregarNativo()}\n[SelfAutomateGravador]::Rodar()`], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    const eventos: EventoDeJanela[] = [];
    let chegouOFim: (() => void) | undefined;
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
                if (!linha.includes('"dpiPorMonitor":true') || !linha.includes('"papelAria":true'))
                    o.aoAviso?.(linha);
                pronto();
                return;
            }
            if (linha.includes('"tipo":"fim"')) {
                chegouOFim?.();
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
            await new Promise<void>((r) => {
                const prazo = setTimeout(r, 4000);
                chegouOFim = () => {
                    clearTimeout(prazo);
                    r();
                };
                processo.stdin?.write('parar\n');
            });
            processo.removeAllListeners('exit');
            processo.kill();
            const m = montarAcoesDeJanela(eventos, o.ignorar, o.fora);
            return { ...m, eventos: eventos.length };
        },
    };
}
