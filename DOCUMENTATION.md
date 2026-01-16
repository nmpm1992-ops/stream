# MeVolt OBS Overlay - Documentação Completa

## Visão Geral

Overlay profissional para OBS Browser Source desenvolvido para streaming de desenvolvimento de memecoin na plataforma Pump.fun. O projeto exibe dados em tempo real, alertas de compra/venda, chat interativo e permite interação do público através de comandos no chat.

## Características Principais

### 1. Três Modos de Exibição

- **Mode 0 (Jardim Canvas)**: `?id=0` ou sem parâmetro
  - Canvas animado com personagem caminhando em um jardim
  - Estatísticas em cards flutuantes (Viewers, Price, Market Cap, Holders)
  - Ambiente interativo e visualmente atraente

- **Mode 1 (Overlay Chroma Key / Green Screen)**: `?id=1`
  - Fundo verde (chroma key) para recorte no OBS
  - Chat ao vivo do Pump.fun exibido (quando disponível)
  - Contadores de compra/venda compactos
  - Personagem mascot que reage a comandos do chat
  - **Nota**: existem elementos de “frames” no HTML, mas no estado atual estão desativados via CSS

- **Mode 2 (Overlay Centralizado)**: `?id=2`
  - Fundo verde (chroma key) para recorte no OBS
  - Similar ao Mode 1, mas com alertas centralizados e bem maiores
  - **Chat não é exibido** na UI (mas comandos ainda podem ser processados via WebSocket/scraping)
  - Ticker de tarefas é exibido neste modo
  - Personagem mascot interativo

### 2. Dados em Tempo Real

#### Viewers
- **Fonte**: Pump.fun (via scraping HTML)
- **Método**: Múltiplos padrões de regex para encontrar contador de viewers
- **Atualização**: A cada 10 segundos
- **Fallback**: Continua tentando mesmo se falhar

#### Preço do Token
- **Fonte**: DexScreener API
- **Endpoint**: `https://api.dexscreener.com/token-pairs/v1/solana/{contract}`
- **Atualização**: Integrado no ciclo de atualização de dados (10s)

#### Market Cap, Holders, Volume 24h, Liquidity
- **Fonte**: DexScreener API (fallback)
- **Scraping**: Tentativa de extrair do HTML do Pump.fun
- **Atualização**: A cada 10 segundos

### 3. WebSocket - Trades em Tempo Real

#### PumpPortal.fun WebSocket
- **URL**: `wss://pumpportal.fun/api/data`
- **Funcionalidade**: 
  - Recebe trades (compras/vendas) em tempo real
  - Reconexão automática em caso de desconexão
  - Status visual de conexão
- **Eventos**:
  - `subscribeTokenTrade`: Inscreve-se em trades de um token específico
  - `trade` ou `txType`: Eventos de compra/venda

#### Chat WebSocket (Pump Fun)
- **URL**: `https://livechat.pump.fun` (Socket.IO)
- **Funcionalidade**:
  - Recebe mensagens do chat em tempo real
  - Processa comandos do chat (`/jump`, `/redobrar`)
  - Fallback para scraping HTML se WebSocket falhar
- **Biblioteca**: Socket.IO 4.5.4 (via CDN)

### 4. Chat Interativo

#### Comandos Disponíveis

**`/jump`**
- Faz o personagem saltar uma vez
- **Mode 0**: Usa física do canvas (personagem sobe e desce)
- **Mode 1/2**: Animação CSS no mascot (classe `.jump`)

**`/redobrar` ou `/double`**
- Faz o personagem saltar duas vezes seguidas
- Útil para efeitos mais visíveis
- Delay de 400ms entre saltos

#### Processamento de Comandos
- Detecta comandos tanto no WebSocket quanto no scraping HTML
- Processa mensagens em tempo real
- Logs no console para debug

**Observação por modo**
- **Mode 1**: o painel de comentários é exibido
- **Mode 2**: o painel de comentários fica oculto por CSS (mas o código ainda tenta consumir chat e processar comandos)

### 5. Alertas de Compra

- **Trigger**: Compras acima do threshold mínimo (padrão: 0.01 SOL)
- **Cooldown**: 1500ms entre alertas
- **Componentes**:
  - Animação de entrada/saída
  - Exibição de wallet (endereço encurtado)
  - Valor em SOL
  - Som de alerta (`alert.mp3`)
  - Personagem mascot com animação de bounce

### 6. Histórico de Compras

- Últimas 5 compras exibidas
- Formato: Wallet encurtado + Valor em SOL
- Atualização em tempo real via WebSocket (PumpPortal) e também via polling Solscan/Helius (fallback)

### 7. Ticker de Tarefas

- **Fonte**: Arquivo JSON local (`MeVoltOBS/tasks.json`)
- **Formato**:
```json
{
  "title": "Working on:",
  "items": ["Task 1", "Task 2", "Task 3"]
}
```
- **Exibição**: Marquee animado infinito
- **Atualização**: A cada 10 segundos

**Observação por modo**
- No estado atual do CSS, o ticker fica **oculto no Mode 1** e **visível no Mode 2**

### 8. Transações Solscan

- **Fonte**: Solscan API (público)
- **Endpoint**: `https://public-api.solscan.io/account/transactions`
- **Fallback**: Helius API
- **Funcionalidade**: Detecta transações de compra para alertas adicionais

## Estrutura do Código

### Configuração (CONFIG)

```javascript
const CONFIG = {
  contract: 'CpqA1pwX5SjU1SgufRwQ59knKGaDMEQ7MQBeu6mpump',
  pumpUrl: 'https://pump.fun/coin/CpqA1pwX5SjU1SgufRwQ59knKGaDMEQ7MQBeu6mpump',
  wsUrl: 'wss://pumpportal.fun/api/data',
  chatWsUrl: 'https://livechat.pump.fun',
  corsProxy: 'https://api.allorigins.win/raw?url=',
  solscanApi: 'https://api.solscan.io',
  minBuyThreshold: 0.01, // SOL
  alertCooldown: 1500 // ms
};
```

### Funções Principais

#### `fetchAllCoinData()`
- Busca todos os dados da moeda (viewers, preço, market cap, etc.)
- Executa a cada 10 segundos
- Combina dados de múltiplas fontes

#### `fetchPumpData()`
- Faz scraping do HTML do Pump.fun (via proxy CORS)
- Extrai viewers, market cap, holders e tenta volume/liquidity

#### `fetchPrice()`
- Busca preço e dados adicionais via DexScreener
- Seleciona o par com maior liquidez quando há múltiplos pares

#### `fetchViewers()`
- Extrai contador de viewers do HTML do Pump.fun
- Usa múltiplos padrões regex
- Atualiza elementos DOM

> Nota: no estado atual, a atualização de viewers acontece principalmente dentro do fluxo de `fetchPumpData()` chamado por `fetchAllCoinData()`.

#### `fetchLiveComments()`
- Busca comentários do chat via scraping HTML
- Processa comandos do chat
- Atualiza display de comentários

> Nota: o polling do scraping de comentários roda a cada ~8 segundos nos modos `id=1` e `id=2`. A UI de comentários fica visível apenas no `id=1`.

#### `connectWS()`
- Conecta ao WebSocket do PumpPortal
- Inscreve-se em trades do token
- Gerencia reconexão automática

#### `connectChatWS()`
- Conecta ao WebSocket do chat (Socket.IO)
- Processa mensagens em tempo real
- Gerencia comandos do chat

#### `processChatCommand(text)`
- Detecta e processa comandos do chat
- Executa ações correspondentes (saltos, etc.)
- Suporta múltiplos modos de exibição

#### `initGarden()` (Mode 0)
- Inicializa canvas do jardim
- Carrega imagens (personagem, logo)
- Cria árvores e elementos do ambiente
- Inicia loop de animação

#### `updateCharacter()` (Mode 0)
- Atualiza física do personagem
- Gerencia movimento, saltos, gravidade
- Detecta colisões com bordas

## APIs e Endpoints Utilizados

### APIs Públicas

1. **DexScreener**
   - `https://api.dexscreener.com/token-pairs/v1/solana/{contract}`
   - Dados: preço, volume, liquidez, market cap

2. **Solscan**
   - `https://public-api.solscan.io/account/transactions`
   - Transações da conta do contrato

3. **Helius** (Fallback)
   - `https://api.helius.xyz/v0/addresses/{contract}/transactions`
   - Transações alternativas

### WebSockets

1. **PumpPortal.fun**
   - `wss://pumpportal.fun/api/data`
   - Trades em tempo real

2. **Pump Fun Chat** (Não oficial)
   - `https://livechat.pump.fun` (Socket.IO)
   - Chat em tempo real

## Servidor Node.js (`server.js`) — Endpoints Locais

O `server.js` serve o `index.html`, fornece **SSE** para chat/trades e endpoints para obter dados da Pump.fun.

### Health
- `GET /health`

### Proxy (CORS-safe, com allowlist de hosts)
- `GET /proxy?url=<URL>`

### Trades (SSE via PumpPortal)
- `GET /trades-sse?mint=<MINT>`

### Coin data (Pump frontend API)
- `GET /pump/coin?mint=<MINT>`
- `GET /coin-sse?mint=<MINT>&interval=<ms>`

### Chat (SSE via livechat.pump.fun)
- `GET /chat-sse?room=<MINT>`
- **Commands-only (recomendado para jogo)**: `GET /chat-sse?room=<MINT>&commands=1`
  - Só emite `event=command` quando a mensagem começa com `/`
  - Exemplo: `/jump` → `cmd="jump"`, `args=[]`

### Chat history (JSON via Socket.IO: `joinRoom` + `getMessageHistory`)
- `GET /chat-scrape?mint=<MINT>`
  - Retorna `{ username, wallet(userAddress), message, timestamp, ... }`
  - Inclui debug do join em `join.authenticated` (se vier `false`, falta auth no `.env`)

### Viewer HTML (para testar manualmente)
- `GET /render/chat?mint=<MINT>`

### Render coin page (debug / visualização)
- `GET /render/coin?mint=<MINT>`
  - Default: **static-safe** (remove scripts para evitar erro de Next.js em localhost)
  - Interativo (pode falhar): `GET /render/coin?mint=<MINT>&mode=interactive`

### Fallback “browser” (somente local — não recomendado em cPanel)
> Estes métodos requerem Chrome com CDP (`--remote-debugging-port=9222`) e uma tab autenticada aberta.

- `GET /chat-browser-scrape?mint=<MINT>` (scrape DOM — frágil)
- `GET /chat-browser-ws?mint=<MINT>&listenMs=15000` (sniff de WebSocket — devolve apenas mensagens novas durante `listenMs`)

## `.env` (Autenticação Pump.fun)

Crie um arquivo `.env` (não versionar) e defina **um** dos itens abaixo:

- `PUMPFUN_JWT=<seu auth_token>`
- `PUMPFUN_COOKIE=<cookie completo do browser>`

Opcional:
- `PUMPFUN_USERNAME=<nome>` (usado no `joinRoom`)

### Proxies CORS

- `https://api.allorigins.win/raw?url=`
- Usado para contornar restrições CORS ao acessar Pump.fun

## Animações e Efeitos

### CSS Animations

- `@keyframes bounce`: Animação de bounce no mascot
- `@keyframes jumpMascot`: Animação de salto (comando `/jump`)
- `@keyframes slideInOut`: Alertas de compra
- `@keyframes slideInOutCenter`: Alertas centralizados

### Canvas Animations (Mode 0)

- Personagem caminhando com física realista
- Árvores com movimento de balanço (sway)
- Partículas (pólen, folhas)
- Flores animadas
- Sombra do personagem que muda com altura do salto

## Setup e Instalação

### Pré-requisitos

- OBS Studio
- Node.js (recomendado: **24.6.0** em produção)
- Navegador moderno com suporte a WebSocket (para o overlay)

### Instalação

1. **Estrutura de Arquivos**:
```
├── index.html          # Arquivo principal (tudo em um)
├── alert.mp3           # Som de alerta (opcional)
├── readme.md           # Documentação básica
├── DOCUMENTATION.md     # Esta documentação
└── MeVoltOBS/
    └── tasks.json       # Tarefas para o ticker
```

2. **Configurar tasks.json**:
```json
{
  "title": "Working on:",
  "items": ["Task 1", "Task 2", "Task 3"]
}
```

3. **Instalar dependências (Node)**:
```bash
npm install
```

4. **Iniciar Servidor Local (Node)**:
```bash
node server.js
```

> Por padrão inicia em `http://localhost:3000` (ou `PORT`).

5. **Configurar OBS**:
   - Adicionar Browser Source
   - URL: `http://localhost:3000/index.html?id=1` (ou id=0, id=2)
   - Largura: 1920px
   - Altura: 1080px
   - Marcar "Shutdown source when not visible"
   - Marcar "Control audio via OBS" (para alertas)

> Dica: nos modos `id=1` e `id=2`, o fundo é verde (#00ff00) para uso com chroma key.

## Personalização

### Alterar Contrato/Token

Edite o objeto `CONFIG` em `index.html`:
```javascript
contract: 'SEU_CONTRACT_AQUI',
pumpUrl: 'https://pump.fun/coin/SEU_CONTRACT_AQUI', // deve bater com o contract
```

### Ajustar Thresholds

```javascript
minBuyThreshold: 0.01, // Mínimo em SOL para alerta
alertCooldown: 1500,    // Cooldown entre alertas (ms)
```

### Modificar Cores/Temas

Edite as variáveis CSS em `:root`:
```css
:root {
  --bg: rgba(10,12,18,.88);
  --good: rgba(90, 255, 170, .95);
  --warn: rgba(255, 210, 120, .95);
  /* ... */
}
```

## Solução de Problemas

### Viewers não aparecem
- Pump.fun pode ter mudado estrutura HTML
- O código tenta múltiplos padrões automaticamente
- Verifique console para erros

### WebSocket não conecta
- Verifique se endpoint PumpPortal está acessível
- Console mostrará erros específicos
- Reconexão automática após 3 segundos

### Chat não funciona
- Se `/chat-scrape` retornar `messageCount: 0`, verifique no JSON:
  - `join.authenticated` deve ser `true` (senão, falta/expirou `PUMPFUN_JWT`/`PUMPFUN_COOKIE`)
- Para comandos no jogo, prefira:
  - `GET /chat-sse?room=<MINT>&commands=1`

### Comandos não funcionam
- Certifique-se que mensagem começa com `/jump` ou `/redobrar`
- Verifique console para logs de detecção
- Funciona tanto via WebSocket quanto scraping

### Erros de CORS
- Use servidor HTTP local (não `file://`)
- Proxy CORS pode estar temporariamente indisponível
- Tente outro proxy se necessário

### Áudio não toca
- Ative "Control audio via OBS" nas configurações
- Ou certifique-se que houve interação do usuário
- Navegadores bloqueiam autoplay por padrão

## Limitações Conhecidas

1. **API de Viewers**: Pump Fun não tem API pública oficial
   - Solução atual: Scraping HTML (frágil)
   - Pode quebrar se estrutura HTML mudar

2. **Chat WebSocket**: Não oficial
   - Pode parar de funcionar a qualquer momento
   - Fallback “browser” existe, mas é pesado e depende de Chrome (apenas local)

3. **CORS**: Requer servidor HTTP local
   - Não funciona via `file://` protocol
   - Depende de proxy CORS público

4. **Rate Limits**: APIs podem ter limites
   - DexScreener: Rate limits não documentados
   - Solscan: Pode ter rate limits

## Melhorias Futuras Sugeridas

1. **Cache de Dados**: Reduzir chamadas de API
2. **Retry Logic**: Melhorar tratamento de erros
3. **Mais Comandos**: Adicionar mais interações do chat
4. **Temas Customizáveis**: Sistema de temas
5. **Configuração via UI**: Interface para mudar settings
6. **Histórico de Trades**: Armazenar histórico localmente
7. **Gráficos**: Adicionar gráfico de preço em tempo real

## Tecnologias Utilizadas

- **HTML5**: Estrutura
- **CSS3**: Estilos e animações
- **JavaScript (Vanilla)**: Lógica e interatividade
- **Canvas API**: Animação do jardim (Mode 0)
- **WebSocket API**: Trades em tempo real
- **Socket.IO**: Chat em tempo real
- **Fetch API**: Requisições HTTP
- **Regex**: Parsing de HTML

## Licença e Créditos

- Desenvolvido para MeVolt
- Personagem e assets: https://mewvolt.online/
- APIs utilizadas: DexScreener, Solscan, PumpPortal.fun

## Contato e Suporte

Para questões ou melhorias, consulte o código-fonte ou abra uma issue no repositório.

---

**Última Atualização**: Inclui sistema de comandos do chat (`/jump`, `/redobrar`) e integração com WebSocket do chat do Pump Fun.

**Última Atualização (Server)**: Endpoints `chat-scrape` (histórico), `chat-sse` com `commands=1` (comandos), e `render/chat` para debug.
