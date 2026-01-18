# Funcionalidades do Slot Machine — MEWVOLT CASINO

Este documento lista todas as funcionalidades implementadas e que devem estar operacionais no sistema.

---

## 📋 Comandos do Chat

### `/start`
- **Funcionalidade**: Entra na fila para jogar o próximo spin
- **Validação**: Respeita limites diários (3 para holders, 1 para não-holders)
- **Processamento**: 
  - Verifica se o utilizador já está na fila
  - Verifica status de holder via endpoint `/holder-check`
  - Verifica se atingiu o limite diário de spins
  - Se válido, adiciona à fila e inicia o spin automaticamente

### `/points`
- **Funcionalidade**: Mostra os pontos atuais do utilizador
- **Exibição**: Exibe pontos acumulados e quantos faltam para 1000
- **Formato**: `📊 {username} has {pontos} points ({restantes} to 1000)`

---

## 🎰 Sistema de Spins e Limites

### Limites Diários
- **Holder**: **3 spins por dia**
  - Definição: Wallet com ≥ $5 USD em MEWVOLT (calculado via preço atual)
  - Verificação: Endpoint `/holder-check` no servidor
  
- **Não-Holder**: **1 spin por dia**
  - Qualquer wallet que não atinja o threshold de $5 USD

### Tracking de Spins
- **Armazenamento**: `slotState.dailySpins[wallet]` — contador por wallet
- **Reset**: Automático à meia-noite (baseado em `lastResetDate`)
- **Validação**: Antes de adicionar à fila, verifica se `dailySpins[wallet] < limit`

### Mensagens de Erro
- **Limite atingido**: Aviso em laranja (`#ff8800`) nos logs
  - Formato: `⚠️ {username} reached daily limit ({limit} spins/day)`
- **Já na fila**: Ignorado silenciosamente (não duplica)

---

## 🎁 Sistema de Prémios (Probabilidades)

Distribuição total: **100%**

| Prémio | Probabilidade | Descrição |
|--------|---------------|-----------|
| **Nada** | 40% | Sem prémio |
| **Extra spin** | 15% | Adiciona novo spin à fila (não conta para limite) |
| **10 pontos** | 15% | Adiciona 10 pontos à wallet |
| **25 pontos** | 10% | Adiciona 25 pontos à wallet |
| **Free Mint NFT** | 10% | Prémio NFT (máx. 2 por dia — global) |
| **Jackpot** | 5% | Prémio acumulado em MEWVOLT |
| **50 pontos** | 5% | Adiciona 50 pontos à wallet |

### Fallback de NFT
- Se o limite diário de NFTs (2) for atingido, o sistema faz fallback para:
  - **25 pontos** (50% chance)
  - **10 pontos** (50% chance)

---

## 💎 Sistema de Pontos

### Acumulação
- **Armazenamento**: `slotState.userPoints[wallet]` — pontos por wallet
- **Persistência**: Guardado em `drive_db.json` via `saveSlotState()`
- **Rollover**: Pontos acumulam indefinidamente até atingir 1000

### Milestone de 1000 Pontos
- **Trigger**: Quando `userPoints[wallet] >= 1000`
- **Recompensa**: **1000 MEWVOLT** enviados automaticamente
- **Payout**: Via endpoint `/payout` (SPL token transfer)
- **Reset**: Após payout, pontos "voltam" — `userPoints[wallet] = userPoints[wallet] - 1000`

### Log de Milestone
- Formato: `🏆 {username} reached 1000 points!`
- Log de payout: `✅ Payout sent: {username} received 1000 MEWVOLT`
- Link TX: `🔗 TX: https://solscan.io/tx/{signature}`

---

## 🎨 Sistema de NFTs

### Free Mint NFT
- **Probabilidade**: 10% (antes de fallback)
- **Limite Diário**: **2 NFTs por dia** (global, não por wallet)
- **Tracking**: `slotState.dailyNFTCount`
- **Reset**: Automático à meia-noite
- **Log**: `🎨 {username} won Free Mint NFT!`

---

## 🎰 Sistema de Jackpot

### Cálculo do Jackpot
- **Base**: `(MEWVOLT comprado no dia anterior em SOL) / 10`
- **Conversão**: Para MEWVOLT usando preço atual do DexScreener
- **Mínimo**: **1000 MEWVOLT** (se pot = 0 ou falha de cálculo)
- **Rollover**: Se o jackpot não sair, acumula para o próximo dia

### Atualização Diária
- **Trigger**: Reset diário (`resetDailySlotData()`)
- **Processo**:
  1. `yesterdayPurchasesSOL = dailyPurchasesSOL`
  2. `updateJackpot()` calcula novo valor
  3. `dailyPurchasesSOL = 0` (reset para novo dia)

### Tracking de Compras
- **Fonte**: WebSocket de trades (`connectWS()`)
- **Evento**: `data.txType === 'buy'` com `data.solAmount >= minBuyThreshold`
- **Atualização**: `slotState.dailyPurchasesSOL += solAmount`
- **Persistência**: Guardado via `saveSlotState()`

### Jackpot Ganho
- **Log**: `🎰 {username} WON THE JACKPOT! {amount} MEWVOLT`
- **Payout**: Automático via `/payout` endpoint
- **Valor**: `slotState.jackpot` MEWVOLT
- **Rollover**: Se não ganhar, jackpot acumula (não reseta a 1000)

---

## 💰 Sistema de Payouts Automáticos

### Condições de Payout
1. **1000 Pontos**: Quando utilizador atinge 1000 pontos
2. **Jackpot**: Quando alguém ganha o jackpot

### Endpoint de Payout
- **URL**: `POST /payout`
- **Autenticação**: Header `x-payout-token` (obtido via `/payout-token`)
- **Payload**:
  ```json
  {
    "kind": "spl",
    "toWallet": "wallet_address",
    "mint": "CpqA1pwX5SjU1SgufRwQ59knKGaDMEQ7MQBeu6mpump",
    "amountTokens": 1000
  }
  ```

### Validação de Wallet
- **Requisito**: `wallet !== null && wallet !== 'unknown'`
- **Se inválida**: Payout ignorado com aviso em laranja
  - Formato: `⚠️ Payout ignored: {username} has no wallet address`

### Logs de Payout
- **Sucesso**: `✅ Payout sent: {username} received {amount} MEWVOLT`
- **Falha**: `❌ Payout failed: {error}`
- **Link TX**: `🔗 TX: https://solscan.io/tx/{signature}`

---

## 🔄 Reset Diário Automático

### Trigger
- **Verificação**: A cada 1 minuto (`setInterval(checkDailyReset, 60000)`)
- **Condição**: `slotState.lastResetDate !== new Date().toDateString()`

### Processo de Reset
1. **Salvar compras do dia**:
   - `yesterdayPurchasesSOL = dailyPurchasesSOL`
   
2. **Calcular novo jackpot**:
   - `updateJackpot()` — baseado em `yesterdayPurchasesSOL / 10`

3. **Resetar contadores diários**:
   - `dailySpins = {}`
   - `dailyNFTCount = 0`
   - `dailyPurchasesSOL = 0`
   - `lastResetDate = new Date().toDateString()`

4. **Persistir estado**:
   - `saveSlotState()` — guarda em `drive_db.json`

### Log de Reset
- Formato: `[Daily Reset] Reset completed for {date}`

---

## 📊 Persistência de Dados

### Drive DB (`drive_db.json`)
- **Estrutura**:
  ```json
  {
    "chats": [...],
    "logs": [...],
    "winners": [...],
    "slotState": {
      "dailySpins": {},
      "userPoints": {},
      "jackpot": 1000,
      "dailyNFTCount": 0,
      "dailyPurchasesSOL": 0,
      "yesterdayPurchasesSOL": 0,
      "lastResetDate": "Mon Jan 01 2024"
    }
  }
  ```

### Endpoints
- **Leitura**: `GET /drive/read` — carrega estado completo
- **Escrita**: `POST /drive/append` — adiciona novos registos e atualiza `slotState`

### Carga Inicial
- **Função**: `loadPersistentData()` — chamada em `init()`
- **Processo**:
  1. Carrega chats, logs, winners
  2. Carrega `slotState` (se existir)
  3. Executa `checkDailyReset()` — verifica se precisa reset
  4. Executa `updateJackpot()` — atualiza display do jackpot

### Guarda Automática
- **Função**: `saveSlotState()`
- **Triggers**:
  - Após incrementar `dailySpins`
  - Após atualizar `dailyPurchasesSOL`
  - Após reset diário
  - Após atualizar `userPoints` ou `jackpot`

---

## 🎬 Animação dos Reels

### Durante o Spin
- **Duração**: 3 segundos
- **CSS**: Animação `symbolSpin` nos símbolos dentro de cada reel
- **Efeito**: Símbolos movem-se verticalmente com opacidade variável
- **Timing**: Cada reel começa com delay de 100ms (escalonado)

### CSS Keyframes
```css
@keyframes symbolSpin {
  0% { transform: translateY(0); opacity: 0.3; }
  50% { opacity: 1; }
  100% { transform: translateY(-106.66px); opacity: 0.3; }
}
```

### Paragem dos Reels
- **Timing**: Reels param com delay de 200ms entre cada um (escalonado)
- **Símbolos Finais**: Baseados no prémio ganho
  - **Jackpot**: Símbolo "7" no reel do meio
  - **Pontos**: Símbolo "BONUS" no primeiro reel
  - **Outros**: Símbolo "BAR" nos reels

---

## 💬 Sistema de Chat

### Processamento de Mensagens
- **Fonte**: WebSocket Socket.IO (`connectChatWS()`)
- **Eventos Escutados**:
  - `message`
  - `new_message`
  - `chat_message`
  - `onAny` (fallback para debug)

### Formato de Dados Suportado
```javascript
{
  user: string,
  username: string,
  text: string,
  message: string,
  wallet: string,
  userAddress: string,
  avatarUrl: string,
  id: string
}
```

### Comandos Processados
- `/start` — entra na fila
- `/points` — mostra pontos

### Persistência
- **Armazenamento**: `chatEntries` (array em memória, máximo 50)
- **Guardar**: Cada mensagem é guardada via `saveToDriveDb()` em `drive_db.json`

### Exibição
- **Ordem**: Mensagens do mais recente para o mais antigo (`flex-direction: column-reverse`)
- **Limite**: Últimas 15 mensagens visíveis no HUD

---

## 📝 Sistema de Logs

### Tipos de Log
- **Info**: Cor padrão (`#ccc`)
- **Sucesso**: Verde (`#00ff73`)
- **Aviso**: Laranja (`#ff8800`)
- **Erro**: Vermelho (`#ff4444`)
- **Especial**: Amarelo/Ouro (`#ffcc00`) para jackpot/milestones

### Entradas de Log
- Jogadores na fila
- Spins executados
- Prémios ganhos
- Limites atingidos
- Payouts enviados
- Compras detectadas
- Reset diário

### Persistência
- **Armazenamento**: `logEntries` (array em memória, máximo 20)
- **Guardar**: Cada log é guardado via `saveToDriveDb()` em `drive_db.json`
- **Estrutura**: `{ ts, username, text, action, userAddress, level }`

---

## 🏆 Sistema de Winners

### Entradas de Winners
- **Trigger**: Quando alguém ganha um prémio (exceto "Nothing" e "Extra spin")
- **Armazenamento**: `winnersEntries` (array em memória, máximo 10)
- **Persistência**: Guardado via `saveToDriveDb()` em `drive_db.json`

### Formato
- **Estrutura**: `{ ts, username, prize, amount }`
- **Exibição**: `{username} won {prize}`

### Prémios Registados
- Pontos (10, 25, 50)
- Free Mint NFT
- Jackpot (com valor em MEWVOLT)

---

## 🌐 Integrações Externas

### WebSocket — Trades (PumpPortal)
- **URL**: `wss://pumpportal.fun/api/data`
- **Função**: Detectar compras em tempo real
- **Evento**: `subscribeTokenTrade` para o contrato MEWVOLT
- **Processamento**: `handleBuy()` — atualiza `dailyPurchasesSOL`

### WebSocket — Chat (Pump.fun)
- **URL**: `https://livechat.pump.fun`
- **Biblioteca**: Socket.IO 4.5.4
- **Função**: Receber mensagens do chat em tempo real
- **Comandos**: Processar `/start` e `/points`

### API — DexScreener
- **URL**: `https://api.dexscreener.com/latest/dex/tokens/{contract}`
- **Função**: 
  - Obter preço MEWVOLT em SOL (para cálculo de jackpot)
  - Obter preço MEWVOLT em USD (para verificação de holder)

### Endpoints Locais (Servidor)
- **`/holder-check`**: Verifica se wallet é holder (≥ $5 USD)
- **`/payout-token`**: Obtém token de autenticação para payouts
- **`/payout`**: Executa transferência SPL token (MEWVOLT)
- **`/drive/read`**: Lê `drive_db.json`
- **`/drive/append`**: Adiciona registos ao `drive_db.json`

---

## 🎯 Fluxo Completo de um Spin

1. **Comando `/start` no chat**
   - `processChatMessage()` recebe mensagem
   - `processChatCommand()` detecta `/start`
   - `addToQueue()` é chamado

2. **Validação em `addToQueue()`**
   - Verifica se já está na fila
   - `checkDailyReset()` — verifica reset se necessário
   - `checkIsHolder(wallet)` — verifica status de holder
   - `getDailySpinLimit(isHolder)` — obtém limite (3 ou 1)
   - Verifica `dailySpins[wallet] < limit`
   - Se válido, adiciona à fila

3. **Processamento em `processQueue()`**
   - Remove jogador da fila
   - Incrementa `dailySpins[wallet]`
   - `spinReels()` — inicia animação (3 segundos)
   - `selectPrize()` — seleciona prémio baseado em probabilidades
   - `stopReels(prize)` — para animação com símbolos finais
   - `processPrize()` — processa prémio ganho

4. **Processamento de Prémio**
   - **Nothing**: Apenas log
   - **Extra spin**: Adiciona à fila novamente
   - **Pontos**: Adiciona pontos, verifica milestone de 1000
   - **NFT**: Incrementa `dailyNFTCount`
   - **Jackpot**: Executa `payoutJackpot()`

5. **Payout (se aplicável)**
   - Verifica wallet válida
   - Obtém token via `/payout-token`
   - Chama `/payout` com dados
   - Log de sucesso/falha com link TX

6. **Persistência**
   - `saveSlotState()` — guarda estado atualizado
   - `saveToDriveDb()` — guarda chats/logs/winners

---

## 🔧 Variáveis de Estado (`slotState`)

```javascript
{
  queue: [],                    // Fila de jogadores
  jackpot: 1000,                // Valor atual do jackpot (MEWVOLT)
  userPoints: {},               // Pontos por wallet: { wallet: points }
  winners: [],                  // Histórico de vencedores (legacy)
  lastResetDate: "Mon Jan 01 2024", // Data do último reset
  dailySpins: {},               // Spins diários por wallet: { wallet: count }
  dailyNFTCount: 0,             // Contador global de NFTs hoje
  dailyPurchasesSOL: 0,         // Compras em SOL hoje
  yesterdayPurchasesSOL: 0      // Compras em SOL ontem (para jackpot)
}
```

---

## ✅ Checklist de Funcionalidades

### Comandos
- [x] `/start` — entra na fila
- [x] `/points` — mostra pontos

### Limites e Validações
- [x] Verificação de holder (≥ $5 USD)
- [x] Limites diários (3 holder, 1 non-holder)
- [x] Tracking de spins por wallet
- [x] Validação de limites antes de entrar na fila
- [x] Aviso visual quando limite atingido

### Prémios
- [x] Probabilidades corretas (40%, 15%, 15%, 10%, 10%, 5%, 5%)
- [x] Fallback de NFT se limite atingido
- [x] Processamento de todos os tipos de prémio

### Pontos e Milestones
- [x] Acumulação de pontos por wallet
- [x] Milestone de 1000 pontos
- [x] Payout automático de 1000 MEWVOLT
- [x] Rollover de pontos após payout

### Jackpot
- [x] Cálculo baseado em compras do dia anterior / 10
- [x] Mínimo de 1000 MEWVOLT
- [x] Rollover quando não ganho
- [x] Tracking de compras SOL
- [x] Conversão SOL → MEWVOLT via DexScreener

### Payouts
- [x] Payout automático para 1000 pontos
- [x] Payout automático para jackpot
- [x] Validação de wallet antes de pagar
- [x] Logs de sucesso/falha com links TX

### Reset Diário
- [x] Verificação automática a cada minuto
- [x] Reset de `dailySpins` e `dailyNFTCount`
- [x] Cálculo de novo jackpot
- [x] Transferência de `dailyPurchasesSOL` → `yesterdayPurchasesSOL`

### Persistência
- [x] Carregar `slotState` do `drive_db.json`
- [x] Guardar `slotState` no `drive_db.json`
- [x] Carregar/guardar chats, logs, winners
- [x] Endpoints `/drive/read` e `/drive/append`

### UI/UX
- [x] Animação dos reels durante spin
- [x] Paragem escalonada dos reels
- [x] Exibição de jackpot atualizado
- [x] Exibição de fila (queue)
- [x] Chat com mensagens do mais recente para o mais antigo
- [x] Logs em tempo real
- [x] Winners destacados

### Integrações
- [x] WebSocket de trades (PumpPortal)
- [x] WebSocket de chat (Pump.fun Socket.IO)
- [x] API DexScreener (preços)
- [x] Endpoint `/holder-check`
- [x] Endpoint `/payout`
- [x] Endpoint `/drive/read` e `/drive/append`

---

## 📌 Notas Importantes

1. **Wallet Validation**: Todos os payouts requerem `userAddress` válido no payload do chat. Se não existir, o payout é ignorado.

2. **Holder Check**: A verificação de holder é feita em tempo real via `/holder-check`, que consulta o balance de MEWVOLT da wallet e compara com o preço atual.

3. **Daily Reset**: O reset diário é baseado em `lastResetDate` comparado com a data atual (`new Date().toDateString()`). Não usa hora específica — qualquer mudança de data trigga o reset.

4. **Jackpot Calculation**: O jackpot é calculado como `yesterdayPurchasesSOL / 10`, convertido para MEWVOLT usando o preço atual. Se não houver compras ontem ou falha de cálculo, o mínimo de 1000 MEWVOLT é aplicado.

5. **Extra Spin**: Quando alguém ganha "Extra spin", é adicionado à fila novamente (`unshift`) mas **não conta para o limite diário** (o limite é verificado apenas em `addToQueue()`, não no "Extra spin").

6. **NFT Limit**: O limite de 2 NFTs por dia é **global** (não por wallet). Se alguém ganhar NFT e o limite estiver cheio, o sistema faz fallback para pontos (não "desperdiça" a probabilidade).

7. **Points Rollover**: Quando alguém atinge 1000 pontos e recebe o payout, os pontos restantes (acima de 1000) são mantidos. Exemplo: se tinha 1250 pontos, recebe payout e fica com 250 pontos.

---

**Última atualização**: Documento gerado com base na implementação atual do sistema.
