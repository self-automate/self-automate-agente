export interface RmDaJanela {
    rm: string;
    projeto: string;
    sistema: string;
    tipo: string;
    inicio: string;
    fim: string;
    tempo: string;
    minha: boolean;
}
export interface JanelaDeRmReportada {
    arquivo: string;
    hash: string;
    titulo: string;
    rms: RmDaJanela[];
}
export interface PedidoDeColeta {
    id: number;
    rms: string[];
    destino: string;
    anexarPacote?: boolean;
}
