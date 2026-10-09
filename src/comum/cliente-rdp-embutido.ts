export const SCRIPT_DO_CLIENTE_RDP = String.raw `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$fonte = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

[ComImport, Guid("C1E6743A-41C1-4A74-832A-0DD06C1C7A0E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface SenhaRdp {
    void put_ClearTextPassword([MarshalAs(UnmanagedType.BStr)] string senha);
}
public static class CredenciaisRdp {
    public static void Aplicar(object controle, string senha) {
        ((SenhaRdp)controle).put_ClearTextPassword(senha);
    }
}
// IMsRdpClientNonScriptable herda IMsTscNonScriptable: no C#, ComImport não herda
// a vtable, então os 10 métodos da base são redeclarados na ordem, e só SendKeys é usado.
[ComImport, Guid("2F079C4C-87B2-4AFD-97AB-20CDB43038AE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface TecladoDoRdp {
    [PreserveSig] int put_ClearTextPassword(IntPtr a);
    [PreserveSig] int put_PortablePassword(IntPtr a);
    [PreserveSig] int get_PortablePassword(IntPtr a);
    [PreserveSig] int put_PortableSalt(IntPtr a);
    [PreserveSig] int get_PortableSalt(IntPtr a);
    [PreserveSig] int put_BinaryPassword(IntPtr a);
    [PreserveSig] int get_BinaryPassword(IntPtr a);
    [PreserveSig] int put_BinarySalt(IntPtr a);
    [PreserveSig] int get_BinarySalt(IntPtr a);
    [PreserveSig] int ResetPassword();
    [PreserveSig] int NotifyRedirectDeviceChange(IntPtr wParam, IntPtr lParam);
    [PreserveSig] int SendKeys(int numKeys, IntPtr pbArrayKeyUp, IntPtr plKeyData);
}
public static class TecladoRdp {
    // Enter (scancode 0x1C), descer e subir: o OK do aviso legal de logon.
    public static void AceitarAviso(object controle) {
        var subir = new short[] { 0, -1 };
        var teclas = new int[] { 0x1C, 0x1C };
        var hSubir = GCHandle.Alloc(subir, GCHandleType.Pinned);
        var hTeclas = GCHandle.Alloc(teclas, GCHandleType.Pinned);
        try {
            int r = ((TecladoDoRdp)controle).SendKeys(2, hSubir.AddrOfPinnedObject(), hTeclas.AddrOfPinnedObject());
            if (r != 0) Marshal.ThrowExceptionForHR(r);
        } finally { hSubir.Free(); hTeclas.Free(); }
    }
}
public static class ComandosRdp {
    // Console.In é sincronizado no .NET Framework: ReadLineAsync pode bloquear o STA.
    public static Task<string> Esperar() {
        return Task.Factory.StartNew(() => Console.ReadLine(), TaskCreationOptions.LongRunning);
    }
}
public sealed class HospedeRdp : AxHost {
    public HospedeRdp() : base("A3BC03A0-041D-42E3-AD22-882B7865C9C5") {}
    public object Controle() { return GetOcx(); }
}
public static class SessoesRdp {
    [StructLayout(LayoutKind.Sequential)]
    public struct Sessao { public int Id; public IntPtr Nome; public int Estado; }
    [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool WTSEnumerateSessions(IntPtr servidor, int reservado, int versao, out IntPtr dados, out int quantidade);
    [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool WTSQuerySessionInformation(IntPtr servidor, int sessao, int classe, out IntPtr dados, out int tamanho);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr dados);
    [DllImport("wtsapi32.dll", SetLastError=true)]
    static extern bool WTSLogoffSession(IntPtr servidor, int sessao, bool esperar);
    public static string Campo(int id, int classe) {
        IntPtr dados; int tamanho;
        if (!WTSQuerySessionInformation(IntPtr.Zero, id, classe, out dados, out tamanho))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try { return Marshal.PtrToStringUni(dados) ?? ""; } finally { WTSFreeMemory(dados); }
    }
    public static int[] DaConta(string dominio, string usuario) {
        IntPtr dados; int quantidade;
        if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out dados, out quantidade))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        var ids = new List<int>();
        try {
            int tamanho = Marshal.SizeOf(typeof(Sessao));
            for (int i=0; i<quantidade; i++) {
                var sessao = (Sessao)Marshal.PtrToStructure(IntPtr.Add(dados, i*tamanho), typeof(Sessao));
                if (sessao.Id == 0 || sessao.Estado == 6 || sessao.Estado == 8) continue;
                if (String.Equals(Campo(sessao.Id, 5), usuario, StringComparison.OrdinalIgnoreCase) &&
                    String.Equals(Campo(sessao.Id, 7), dominio, StringComparison.OrdinalIgnoreCase)) ids.Add(sessao.Id);
            }
            return ids.ToArray();
        } finally { WTSFreeMemory(dados); }
    }
    public static void Logoff(int id) {
        if (id <= 0) throw new InvalidOperationException();
        if (!WTSLogoffSession(IntPtr.Zero, id, true))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
$sessaoCriada = $null
$registroCriado = $null
$trava = $null
$travou = $false
$form = $null
$controle = $null
$motivo = 'INICIALIZACAO'
$log = 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational'
function Emitir($tipo, $campos) {
    $campos.tipo = $tipo
    [Console]::WriteLine(($campos | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
function Eventos($inicio) {
    # XPath vazio retorna coleção vazia; falta de acesso ao log é erro.
    $xpath = '*[System[(EventID=21 or EventID=25) and EventRecordID > ' + $inicio + ']]'
    $q = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery($log, [System.Diagnostics.Eventing.Reader.PathType]::LogName, $xpath)
    $leitor = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($q)
    try {
        while ($null -ne ($e = $leitor.ReadEvent())) {
            try {
                [xml]$xml = $e.ToXml()
                $dados = $xml.Event.UserData.EventXML
                if ($dados.User -ieq ($dominio + '\' + $usuario)) {
                    [pscustomobject]@{ id=[int]$e.Id; registro=[long]$e.RecordId; sessao=[int]$dados.SessionID; origem=[string]$dados.Address }
                }
            } finally { $e.Dispose() }
        }
    } finally { $leitor.Dispose() }
}
function FecharCriada {
    if ($null -eq $sessaoCriada) { return }
    $atuais = @([SessoesRdp]::DaConta($dominio, $usuario))
    if ($atuais -notcontains $sessaoCriada) { return }
    # Não encerra um número reaproveitado, nem uma sessão reconectada por outro cliente.
    $posteriores = @(Eventos $registroCriado | Where-Object { $_.sessao -eq $sessaoCriada })
    if ($posteriores.Count -gt 0) { throw 'IDENTIDADE_ALTERADA' }
    [SessoesRdp]::Logoff($sessaoCriada)
}
try {
    Add-Type -TypeDefinition $fonte -ReferencedAssemblies System.Windows.Forms,System.Drawing -ErrorAction Stop
    $motivo = 'CREDENCIAL'
    $pedido = [Console]::ReadLine() | ConvertFrom-Json
    if ($pedido.usuario -notmatch '^([^\\]+)\\([^\\]+)$' -or !$pedido.senha) { throw 'CREDENCIAL' }
    $dominio = $Matches[1]; $usuario = $Matches[2]
    $trava = New-Object System.Threading.Mutex($false, ('Global\SelfAutomate-RDP-' + $dominio + '-' + $usuario))
    $motivo = 'CONCORRENCIA'
    try { $travou = $trava.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $travou = $true }
    if (!$travou) { throw 'CONCORRENCIA' }
    $motivo = 'CONSULTA_SESSAO'
    if (@([SessoesRdp]::DaConta($dominio, $usuario)).Count -ne 0) { $motivo = 'SESSAO_EXISTENTE'; throw $motivo }
    $motivo = 'AUDITORIA'
    $ultimo = Get-WinEvent -LogName $log -MaxEvents 1 -ErrorAction Stop
    $inicio = [long]$ultimo.RecordId
    $ultimo.Dispose()
    $motivo = 'ACTIVEX'
    $form = New-Object System.Windows.Forms.Form
    $form.ShowInTaskbar = $false
    $form.Opacity = 0
    $form.Width = 800; $form.Height = 600
    $hostRdp = New-Object HospedeRdp
    ([System.ComponentModel.ISupportInitialize]$hostRdp).BeginInit()
    $hostRdp.Dock = [System.Windows.Forms.DockStyle]::Fill
    $form.Controls.Add($hostRdp)
    ([System.ComponentModel.ISupportInitialize]$hostRdp).EndInit()
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    $controle = $hostRdp.Controle()
    $controle.Server = '127.0.0.1'
    $controle.Domain = $dominio
    $controle.UserName = $usuario
    $controle.DesktopWidth = 1024; $controle.DesktopHeight = 768
    $controle.AdvancedSettings7.EnableCredSspSupport = $true
    # 0: o servidor de RPA medido usa SecurityLayer 0 (RDP nativo, sem TLS) e o servidor
    # não tem como se autenticar; com 1 o cliente parou mudo (execução 540).
    # Só é aceitável porque o destino é 127.0.0.1 — a conexão não sai da máquina.
    $controle.AdvancedSettings7.AuthenticationLevel = 0
    $controle.AdvancedSettings7.EnableAutoReconnect = $false
    [CredenciaisRdp]::Aplicar($controle, [string]$pedido.senha)
    $pedido.senha = $null; $pedido = $null
    # Segunda verificação imediatamente antes de Connect.
    $motivo = 'CONSULTA_SESSAO'
    if (@([SessoesRdp]::DaConta($dominio, $usuario)).Count -ne 0) { $motivo = 'SESSAO_EXISTENTE'; throw $motivo }
    $motivo = 'CONEXAO'
    $controle.Connect()
    $limite = [DateTime]::UtcNow.AddSeconds(60)
    $comando = [ComandosRdp]::Esperar()
    $pronta = $false
    # Aviso legal de logon (execução 542): segura o logon automático até um OK.
    # Poucas tentativas: se a tela for de SENHA, cada Enter vira um 4625, e a
    # conta é de domínio — o caso de 29/09 foi bloqueio.
    $maxAvisos = 3
    $avisos = 0
    $proximoAviso = [DateTime]::UtcNow.AddSeconds(3)
    while ([DateTime]::UtcNow -lt $limite) {
        [System.Windows.Forms.Application]::DoEvents()
        $eventos = @(Eventos $inicio)
        if (@($eventos | Where-Object { $_.id -eq 25 }).Count -gt 0) { $motivo='RECONEXAO'; throw $motivo }
        $novos = @($eventos | Where-Object { $_.id -eq 21 -and $_.origem -in @('127.0.0.1','::1') })
        if ($novos.Count -gt 1) { $motivo='AUDITORIA_AMBIGUA'; throw $motivo }
        if ($novos.Count -eq 0 -and $controle.Connected -eq 1 -and $avisos -lt $maxAvisos -and [DateTime]::UtcNow -ge $proximoAviso) {
            $avisos++
            $proximoAviso = [DateTime]::UtcNow.AddSeconds(5)
            $motivo = 'AVISO_LEGAL'
            $hostRdp.Focus() | Out-Null
            [TecladoRdp]::AceitarAviso($controle)
            $motivo = 'CONEXAO'
        }
        if ($novos.Count -eq 1) {
            $sessaoCriada = $novos[0].sessao; $registroCriado = $novos[0].registro
            $ids = @([SessoesRdp]::DaConta($dominio, $usuario))
            if ($ids.Count -ne 1 -or $ids[0] -ne $sessaoCriada) { $motivo='IDENTIDADE_ALTERADA'; throw $motivo }
            $explorers = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object {
                if ($_.SessionId -ne $sessaoCriada) { return $false }
                $dono = Invoke-CimMethod -InputObject $_ -MethodName GetOwner
                $dono.ReturnValue -eq 0 -and $dono.User -ieq $usuario -and $dono.Domain -ieq $dominio
            })
            if ($explorers.Count -gt 0 -and $controle.Connected -eq 1) { $pronta=$true; break }
        }
        if ($comando.IsCompleted) { $motivo='CANCELADO'; throw $motivo }
        Start-Sleep -Milliseconds 100
    }
    if (!$pronta) { $motivo = $(if ($avisos -gt 0) { 'PRAZO_APOS_AVISO' } else { 'PRAZO' }); throw $motivo }
    Emitir 'pronta' @{ sessao=$sessaoCriada; evento=21; registro=$registroCriado }
    # A conexão permanece viva até o chamador pedir fechar ou fechar o pipe.
    while (!$comando.IsCompleted) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
    }
    $motivo = 'LOGOFF'
    FecharCriada
    $sessaoCriada = $null
    Emitir 'fechada' @{}
} catch {
    # Nunca serializa a exceção: COM/PowerShell podem repetir dados recebidos.
    Emitir 'erro' @{ motivo=$motivo }
} finally {
    try { FecharCriada } catch { Emitir 'erro' @{ motivo='LOGOFF' } }
    if ($null -ne $controle) { try { $controle.Disconnect() } catch {} }
    if ($null -ne $form) { $form.Dispose() }
    if ($travou) { $trava.ReleaseMutex() }
    if ($null -ne $trava) { $trava.Dispose() }
}
`;
