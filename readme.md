# MeVolt OBS Web Overlay

Um overlay profissional para OBS Browser Source para streaming de desenvolvimento de memecoin com atividade de token em tempo real, alertas de compra/venda e ticker de tarefas.

## Características

- **Dois Modos de Exibição:**
  - **Página 0 (Painel Completo):** Overlay full-screen com branding, estatísticas e player opcional
  - **Página 1 (Overlay Transparente):** Overlay transparente com frames visuais para screen share e câmera (`?id=1`)

- **Dados em Tempo Real:**
  - Contador de viewers do Pump.fun (via proxy CORS)
  - Preço do token via DexScreener (SOL/USD)
  - Feed de trades ao vivo via PumpPortal WebSocket

- **Componentes UI:**
  - Contadores de Compra/Venda
  - Painel de últimas 5 compras
  - Alertas estilo doação para compras com animação e som
  - Ticker de tarefas a partir de arquivo JSON local

## Setup

### Pré-requisitos

- OBS Studio
- Servidor web local (qualquer um serve: Python `python -m http.server`, Node `npx serve`, etc.) ou abrir diretamente via `file://`

### Instalação

1. Coloque o arquivo `alert.mp3` na raiz do projeto para sons de alerta (opcional).

2. Edite `MeVoltOBS/tasks.json` com suas tarefas atuais:
```json
{
  "title": "Working on:",
  "items": ["Task 1", "Task 2", "Task 3"]
}
```

### OBS Setup

**Opção 1: Servidor Local (Recomendado)**
1. Inicie um servidor HTTP local na pasta do projeto:
   - Python: `python -m http.server 8000`
   - Node: `npx serve .`
   - Ou use qualquer servidor estático
2. Em OBS, adicione uma **Browser Source**
3. Configure a URL:
   - **Painel Completo:** `http://localhost:8000/index.html`
   - **Overlay Transparente:** `http://localhost:8000/index.html?id=1`
4. Defina largura: `1920` e altura: `1080` (ou sua resolução de stream)
5. Marque "Shutdown source when not visible" (opcional)
6. Marque "Control audio via OBS" se quiser controlar o volume do alerta

**Opção 2: File Protocol (Pode ter limitações de CORS)**
1. Abra `index.html` diretamente no navegador
2. Copie o caminho `file://` completo
3. Use em OBS Browser Source (algumas funcionalidades podem não funcionar devido a CORS)

### Configuração

Edite o objeto `CONFIG` em `index.html` para personalizar:
- Endereço do contrato
- URL do Pump.fun
- Threshold mínimo de compra para alertas (padrão: 0.01 SOL)
- Cooldown de alertas (padrão: 1500ms)

## Estrutura de Arquivos

```
├── index.html          # Overlay principal HTML/CSS/JS (tudo em um arquivo)
├── alert.mp3           # Arquivo de som de alerta (adicione este arquivo)
└── MeVoltOBS/
    └── tasks.json      # Dados do ticker de tarefas
```

## Notas

- **CORS Proxy:** O código usa `api.allorigins.win` como proxy CORS para acessar Pump.fun. Se preferir outro proxy, altere `CONFIG.corsProxy`
- WebSocket reconecta automaticamente em caso de desconexão
- Polling de dados acontece em intervalos especificados (viewers: 5s, preço: 4s, tarefas: 5s)
- Som de alerta requer interação do usuário ou controle de áudio via OBS devido a restrições de autoplay do navegador

## Solução de Problemas

- **Viewers não aparecem:** Pump.fun pode ter mudado estrutura HTML; múltiplos padrões são tentados
- **Preço não atualiza:** Verifique se DexScreener tem dados do seu token
- **WebSocket não conecta:** Verifique console para erros; certifique-se que endpoint PumpPortal está acessível
- **Áudio não toca:** Ative "Control audio via OBS" ou certifique-se que houve interação do usuário
- **Erros de CORS:** Use um servidor local HTTP em vez de abrir direto via `file://`
