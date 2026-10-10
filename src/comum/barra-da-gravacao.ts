import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
export interface EstadoDaBarra {
    acoes: number;
    ultima?: string;
    aviso?: string;
}
const corte = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
export function textoDaBarra(e: EstadoDaBarra): {
    contador: string;
    ultima: string;
    aviso: string;
} {
    const contador = e.acoes === 0 ? 'Gravando · nenhuma ação ainda' : `Gravando · ${e.acoes} ${e.acoes === 1 ? 'ação' : 'ações'}`;
    return { contador, ultima: corte(e.ultima ?? '', 80), aviso: corte(e.aviso ?? '', 140) };
}
const jsonAscii = (o: unknown): string => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const CODIGO_DA_BARRA = `
using System;
using System.Collections.Generic;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Web.Script.Serialization;

public static class SelfAutomateBarra {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static readonly object Trava = new object();

  static void Dizer(string tipo) {
    lock (Trava) { Console.Out.WriteLine("{\\"tipo\\":\\"" + tipo + "\\"}"); Console.Out.Flush(); }
  }

  static TextBlock Texto(string id, double tamanho, FontWeight peso, Brush cor) {
    var t = new TextBlock { FontSize = tamanho, FontWeight = peso, Foreground = cor, MaxWidth = 520, TextTrimming = TextTrimming.CharacterEllipsis };
    System.Windows.Automation.AutomationProperties.SetAutomationId(t, id);
    return t;
  }

  static void Por(TextBlock t, Dictionary<string, object> d, string chave) {
    object v;
    var texto = d.TryGetValue(chave, out v) && v != null ? v.ToString() : "";
    t.Text = texto;
    t.Visibility = texto.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
  }

  public static void Rodar() {
    var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
    var w = new Window {
      Title = "Self Automate - gravando", WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize,
      Topmost = true, ShowInTaskbar = false, SizeToContent = SizeToContent.WidthAndHeight,
      Background = new SolidColorBrush(Color.FromRgb(0x1f, 0x1f, 0x1f)), BorderBrush = Brushes.Red, BorderThickness = new Thickness(2)
    };
    System.Windows.Automation.AutomationProperties.SetAutomationId(w, "barraDaGravacao");
    var painel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(6, 6, 10, 6) };
    // A ALCA: seis pontos, o desenho de "isto se arrasta" em qualquer barra flutuante.
    // Para mover a barra quando ela estiver na frente do que a pessoa precisa clicar.
    var alca = new WrapPanel { Width = 10, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
    System.Windows.Automation.AutomationProperties.SetAutomationId(alca, "alca");
    for (int i = 0; i < 6; i++) alca.Children.Add(new Ellipse { Width = 3, Height = 3, Fill = Brushes.Gray, Margin = new Thickness(1) });
    var bola = new Ellipse { Width = 10, Height = 10, Fill = Brushes.Red, Margin = new Thickness(0, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center };
    var textos = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
    var contador = Texto("contador", 13, FontWeights.SemiBold, Brushes.White);
    var ultima = Texto("ultima", 11, FontWeights.Normal, Brushes.LightGray);
    var aviso = Texto("aviso", 11, FontWeights.Normal, Brushes.Orange);
    ultima.Visibility = Visibility.Collapsed;
    aviso.Visibility = Visibility.Collapsed;
    textos.Children.Add(contador);
    textos.Children.Add(ultima);
    textos.Children.Add(aviso);
    var parar = new Button { Content = "Parar", Margin = new Thickness(14, 0, 0, 0), Padding = new Thickness(14, 4, 14, 4), VerticalAlignment = VerticalAlignment.Center };
    System.Windows.Automation.AutomationProperties.SetAutomationId(parar, "parar");
    parar.Click += (s, e) => { parar.IsEnabled = false; parar.Content = "parando..."; Dizer("parar"); };
    painel.Children.Add(alca);
    painel.Children.Add(bola);
    painel.Children.Add(textos);
    painel.Children.Add(parar);
    w.Content = painel;
    // Arrastavel: a pessoa tira do caminho do que esta gravando.
    w.MouseLeftButtonDown += (s, e) => { try { w.DragMove(); } catch { } };
    w.Cursor = Cursors.SizeAll;
    parar.Cursor = Cursors.Hand;
    w.ToolTip = "Arraste para mover";
    w.Loaded += (s, e) => {
      var a = SystemParameters.WorkArea;
      w.Left = a.Left + (a.Width - w.ActualWidth) / 2;
      w.Top = a.Top + 8;
      Dizer("pronta");
    };
    new Thread(() => {
      string linha;
      while ((linha = Console.In.ReadLine()) != null) {
        try {
          var d = Json.Deserialize<Dictionary<string, object>>(linha);
          w.Dispatcher.BeginInvoke(new Action(() => { Por(contador, d, "contador"); Por(ultima, d, "ultima"); Por(aviso, d, "aviso"); }));
        } catch { }
      }
      // A entrada fechou: o agente terminou a gravacao (ou morreu). A barra some junto.
      w.Dispatcher.BeginInvoke(new Action(() => w.Close()));
    }) { IsBackground = true }.Start();
    app.Run(w);
  }
}
`;
const CARREGAR_A_BARRA = `
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Web.Extensions
Add-Type -ReferencedAssemblies PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Web.Extensions -TypeDefinition @'
${CODIGO_DA_BARRA}
'@
[SelfAutomateBarra]::Rodar()
`;
export interface BarraDaGravacao {
    processo: number;
    parada: Promise<void>;
    atualizar(estado: EstadoDaBarra): void;
    fechar(): void;
}
export async function abrirBarraDaGravacao(): Promise<BarraDaGravacao> {
    const processo = spawn('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', CARREGAR_A_BARRA], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let erro = '';
    processo.stderr.on('data', (c: Buffer) => (erro += c.toString()));
    let avisarParada!: () => void;
    const parada = new Promise<void>((r) => (avisarParada = r));
    await new Promise<void>((pronta, falhou) => {
        const prazo = setTimeout(() => falhou(new Error(`a barra da gravação não abriu em 30 s${erro ? `: ${erro.slice(0, 300)}` : ''}`)), 30000);
        processo.once('exit', (codigo) => {
            clearTimeout(prazo);
            falhou(new Error(`a barra da gravação saiu (${codigo})${erro ? `: ${erro.slice(0, 300)}` : ''}`));
        });
        createInterface({ input: processo.stdout }).on('line', (linha) => {
            if (linha.includes('"tipo":"pronta"')) {
                clearTimeout(prazo);
                pronta();
            }
            else if (linha.includes('"tipo":"parar"')) {
                avisarParada();
            }
        });
    });
    processo.removeAllListeners('exit');
    const escrever = (estado: EstadoDaBarra): void => {
        if (processo.stdin.writable)
            processo.stdin.write(`${jsonAscii(textoDaBarra(estado))}\n`);
    };
    escrever({ acoes: 0 });
    return {
        processo: processo.pid ?? 0,
        parada,
        atualizar: escrever,
        fechar: () => {
            processo.stdin.end();
            setTimeout(() => processo.kill(), 2000).unref();
        },
    };
}
