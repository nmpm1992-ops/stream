### Regras do jogo (Slot Machine — MeVolt)

### Como entrar / comandos
- **`/start`**: entra na fila para jogar o próximo spin (respeita limites diários).
- **`/points`**: mostra os teus pontos atuais e quantos faltam para 1000.

### Quem pode jogar (limite diário)
- **Holder**: **3 spins por dia**
- **Não-holder**: **1 spin por dia**
- **Definição de Holder**: a wallet (`userAddress` no payload do chat) tem **≥ $5** em MEWVOLT (valor calculado via preço) no momento em que é validada.
- Se o utilizador já atingiu o limite: aparece **aviso em laranja nos logs** e **não entra na fila**.

### Prémios por spin (probabilidades)
Distribuição (100% total):
- **Nada**: 40%
- **Extra spin**: 15%
- **10 pontos**: 15%
- **25 pontos**: 10%
- **Free Mint NFT**: 10% *(máx. 2 por dia — global)*
- **Jackpot**: 5%
- **50 pontos**: 5%

### Pontos (recompensa por milestones)
- Os pontos acumulam por wallet/user.
- Ao atingir **1000 pontos**, o utilizador recebe **1000 MEWVOLT**.
- Depois do payout, os pontos “voltam” (fica o resto acima de 1000).

### NFT (Free Mint)
- Pode sair como prémio.
- **Limite**: no máximo **2 por dia** (global).
- Se o limite diário estiver cheio, o sistema faz fallback para um prémio de pontos (para não “desperdiçar” a probabilidade).

### Jackpot (MEWVOLT)
- O jackpot é **pago em MEWVOLT**.
- **Pot diário**:
  - base: **(MEWVOLT comprado no dia anterior) / 10**
  - se o jackpot não sair, **acumula** (rollover).
- **Pot mínimo**: se o pot estiver **0**, o jackpot assume por defeito **1000 MEWVOLT**.

### Pagamentos automáticos (payout)
- Quando sai **Jackpot** ou quando alguém atinge **1000 pontos**, o payout é feito automaticamente para a wallet (`userAddress`).
- Se não houver wallet no payload (sem `userAddress`), o payout é **ignorado** e aparece aviso.
- O payout é assinado no **servidor** (nunca no browser).

### Registo de recompensas (auditoria)
- Cada prémio/payout pode ser registado com estado:
  - **pendente**
  - **pago**
  - **falhou**
- O registo inclui o link da transação (ex.: Solscan).

