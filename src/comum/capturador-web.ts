import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import { ehGestoNaoGravado, lerGravacao, type AcaoGravada, type GestoNaoGravado } from './gravacao.js';
export const PREFIXO_DA_PONTE = '__selfAutomateGravar';
const JANELA_DO_GESTO_MS = 4000;
export function scriptDoCapturador(ponte: string): string {
    return `(() => {
  if (window.__selfAutomateGravando) return;
  window.__selfAutomateGravando = true;
  const enviar = (a) => { try { window[${JSON.stringify(ponte)}](a); } catch (e) {} };
  // G5c2: o gesto que não vira passo é CONTADO, pelo nome e sem valor.
  const gesto = (g) => enviar({ gesto: g });
  if (window.top !== window) {
    // Num quadro (iframe), nada é gravado — o seletor da página de cima não o
    // alcança. Conta o clique e o campo alterado; o valor não sai daqui.
    document.addEventListener('click', (ev) => { if (ev.isTrusted) gesto('iframe'); }, true);
    document.addEventListener('change', (ev) => { if (ev.isTrusted) gesto('iframe'); }, true);
    return;
  }
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'));
  const aspas = (s) => s.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const unico = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const gerado = (v) => /\\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}|:|^[a-z]{1,3}-?\\d+$/i.test(v);
  const papel = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName;
    if (t === 'BUTTON' || (t === 'INPUT' && /^(submit|button|reset)$/i.test(el.type))) return 'button';
    if (t === 'A' && el.hasAttribute('href')) return 'link';
    return null;
  };
  const nome = (el) =>
    (el.getAttribute('aria-label') || (el.tagName === 'INPUT' ? el.value : el.innerText) || '').trim().replace(/\\s+/g, ' ');
  const seletorDe = (el) => {
    if (el.id && !gerado(el.id) && unico('#' + esc(el.id))) return '#' + esc(el.id);
    for (const at of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
      const v = el.getAttribute(at);
      if (v) { const s = '[' + at + '="' + aspas(v) + '"]'; if (unico(s)) return s; }
    }
    const nm = el.getAttribute('name');
    if (nm) { const s = el.tagName.toLowerCase() + '[name="' + aspas(nm) + '"]'; if (unico(s)) return s; }
    const r = papel(el);
    const n = nome(el);
    if (r && n && n.length <= 80) {
      const iguais = [...document.querySelectorAll('button,a[href],input[type=submit],input[type=button],input[type=reset],[role]')]
        .filter((e) => papel(e) === r && nome(e) === n);
      if (iguais.length === 1) return 'role=' + r + '[name="' + aspas(n) + '"]';
    }
    const partes = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id && !gerado(e.id) && unico('#' + esc(e.id))) { partes.unshift('#' + esc(e.id)); break; }
      const tag = e.tagName.toLowerCase();
      const irmaos = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : [e];
      partes.unshift(irmaos.length > 1 ? tag + ':nth-of-type(' + (irmaos.indexOf(e) + 1) + ')' : tag);
    }
    return partes.join(' > ');
  };
  const ehCaixa = (el) => el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type);
  const ehCampo = (el) =>
    el.tagName === 'TEXTAREA' || el.isContentEditable ||
    (el.tagName === 'INPUT' && !/^(submit|button|reset|checkbox|radio|file|image|hidden)$/i.test(el.type));
  const ehSenha = (el) => el.tagName === 'INPUT' && /^password$/i.test(el.type);

  document.addEventListener('contextmenu', (ev) => { if (ev.isTrusted) gesto('cliqueDireito'); }, true);
  document.addEventListener('dblclick', (ev) => { if (ev.isTrusted) gesto('duploClique'); }, true);
  document.addEventListener('dragstart', (ev) => { if (ev.isTrusted) gesto('arrastar'); }, true);

  document.addEventListener('click', (ev) => {
    if (!ev.isTrusted || !(ev.target instanceof Element)) return;
    const el = ev.target.closest('button,a[href],input,select,textarea,label,[role],[onclick]') || ev.target;
    if (el.tagName === 'SELECT' || ehCampo(el) || ehCaixa(el)) return;
    if (el.tagName === 'LABEL' && el.control && (ehCaixa(el.control) || ehCampo(el.control))) return;
    enviar({ tipo: 'web.clicar', seletor: seletorDe(el) });
  }, true);

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (!(el instanceof Element) || !ehCampo(el)) return;
    // Senha: avisa na hora, na ordem do que a pessoa fez, SEM ler o valor. O
    // "change" dela só viria quando o foco saísse — depois do passo seguinte.
    if (ehSenha(el)) return void enviar({ tipo: 'web.preencherSegredo', seletor: seletorDe(el) });
    enviar({ tipo: 'web.preencher', seletor: seletorDe(el), valor: el.isContentEditable ? el.innerText : el.value });
  }, true);

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!(el instanceof Element)) return;
    if (el.tagName === 'INPUT' && /^file$/i.test(el.type)) return void gesto('arquivo');
    if (el.tagName === 'SELECT') {
      const o = el.selectedOptions[0];
      if (o) enviar({ tipo: 'web.selecionar', seletor: seletorDe(el), texto: o.text.trim() });
      return;
    }
    if (ehCaixa(el)) enviar({ tipo: 'web.marcar', seletor: seletorDe(el), marcado: el.checked });
  }, true);

  document.addEventListener('keydown', (ev) => {
    if (!ev.isTrusted || !(ev.target instanceof Element)) return;
    if (/^F([1-9]|1[0-2])$/.test(ev.key)) return void gesto('teclaDeFuncao');
    // Atalho: Ctrl, Alt ou Cmd com outra tecla. Fora o AltGr (Ctrl+Alt de
    // teclado brasileiro, que DIGITA @ e outros) e o Ctrl+V, cujo colado entra
    // pelo valor do campo.
    const altGr = ev.getModifierState && ev.getModifierState('AltGraph');
    if ((ev.ctrlKey || ev.altKey || ev.metaKey) && !altGr && !/^(Control|Alt|Meta|Shift|AltGraph)$/.test(ev.key)) {
      if (!((ev.ctrlKey || ev.metaKey) && /^v$/i.test(ev.key))) gesto('atalho');
      return;
    }
    const tecla = { Enter: 'ENTER', Escape: 'ESC' }[ev.key];
    if (!tecla) return;
    enviar({ tipo: 'web.teclar', tecla });
  }, true);
})();`;
}
export async function gravarNoNavegador(contexto: BrowserContext, aoGravar: (a: AcaoGravada) => void, aoGesto?: (g: GestoNaoGravado) => void): Promise<void> {
    let ultimoGesto = 0;
    let ultima = '';
    const entregar = (bruto: unknown): void => {
        const lida = lerGravacao({ versao: 1, acoes: [bruto] }).gravacao?.acoes[0];
        if (!lida)
            return;
        const chave = JSON.stringify(lida);
        if (chave === ultima)
            return;
        ultima = chave;
        if (lida.tipo !== 'web.abrir')
            ultimoGesto = Date.now();
        aoGravar(lida);
    };
    const ponte = `${PREFIXO_DA_PONTE}_${randomUUID().replace(/-/g, '')}`;
    await contexto.exposeBinding(ponte, (fonte, acao: unknown) => {
        const g = acao && typeof acao === 'object' ? (acao as {
            gesto?: unknown;
        }).gesto : undefined;
        if (fonte.frame !== fonte.page.mainFrame()) {
            if (g === 'iframe')
                aoGesto?.('iframe');
            return;
        }
        if (g !== undefined) {
            if (ehGestoNaoGravado(g))
                aoGesto?.(g);
            return;
        }
        entregar(acao);
    });
    await contexto.addInitScript(scriptDoCapturador(ponte));
    const vigiar = (pagina: Page): void => {
        pagina.on('framenavigated', (quadro) => {
            if (quadro !== pagina.mainFrame())
                return;
            if (Date.now() - ultimoGesto < JANELA_DO_GESTO_MS)
                return;
            entregar({ tipo: 'web.abrir', url: quadro.url() });
        });
    };
    for (const p of contexto.pages())
        vigiar(p);
    contexto.on('page', vigiar);
}
