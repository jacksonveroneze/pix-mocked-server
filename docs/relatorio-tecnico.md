# Relatório Técnico — PIX Mocked Server

## 1. Objetivo

O **PIX Mocked Server** é um *mock server* da API Pix do Banco Central do Brasil (BACEN), seguindo a especificação pública disponível em <https://bacen.github.io/pix-api/>. Ele simula o comportamento de um **PSP (Provedor de Serviços de Pagamento)**, oferecendo uma *sandbox* local para testar integrações de cobranças Pix (imediatas, com vencimento e recorrentes), *locations* e fluxo de autenticação, sem depender dos ambientes de homologação dos bancos.

A aplicação sobe **dois servidores NestJS** no mesmo processo (`src/main.ts`):

| Servidor | Módulo | Porta | Swagger |
|---|---|---|---|
| API Pix (cobranças, locations, recorrências) | `AppModule` | **3000** | `http://localhost:3000/api-docs` |
| Autenticação | `AuthModule` | **3001** | `http://localhost:3001/api-docs` |

## 2. Stack

| Item | Tecnologia |
|---|---|
| Linguagem | TypeScript 5 |
| Runtime | Node.js 20 |
| Framework | NestJS 10 (`@nestjs/core`, `@nestjs/common`) |
| Servidor HTTP | Express (`@nestjs/platform-express`) |
| Documentação | Swagger/OpenAPI (`@nestjs/swagger` 7) |
| Validação | `class-validator` + `class-transformer` (via `ValidationPipe` global e validadores customizados) |
| Testes | Jest 29 + `ts-jest` + Supertest |
| Persistência | `MemoryDB` — banco em memória próprio (`src/libs/fakedb.ts`), sem dependência externa |
| Dados iniciais | `src/data/db.json` (`owners` e `correntistas`) e `src/data/municipios.json` |

## 3. Estrutura e arquitetura

### 3.1 Árvore de diretórios (`src/`)

```
src/
├── main.ts                     # Bootstrap: MemoryDB + API (3000) e Auth (3001)
├── app.module.ts               # Módulo da API Pix (controllers + provider PSP)
├── auth.module.ts              # Módulo de autenticação (AuthController + Auth)
├── http.interceptor.ts         # Header mocked-token + erros padrão BACEN
├── swagger-app.config.ts       # Configuração Swagger da API (porta 3000)
├── swagger-auth.config.ts      # Configuração Swagger da Auth (porta 3001)
├── controllers/
│   ├── auth.controller.ts      # POST /auth
│   ├── auth.models.ts          # DTO ValidateInput
│   ├── cob.controller.ts       # /cob   — cobrança imediata
│   ├── cobv.controller.ts      # /cobv  — cobrança com vencimento
│   ├── cobr.controller.ts      # /cobr  — cobrança recorrente
│   ├── rec.controller.ts       # /rec   — recorrências
│   ├── location.controller.ts  # /loc   — locations (payload/QR Code)
│   ├── webhook.controller.ts   # vazio (não implementado)
│   └── fakedb.ts               # cópia de libs/fakedb.ts (não usada)
├── core/
│   ├── app/
│   │   ├── psp.ts              # Serviço PSP (regras de negócio)
│   │   ├── models.ts           # Tipos comuns (PixRequest, TipoCob...)
│   │   ├── validators.ts       # Validadores de domínio
│   │   └── models/             # DTOs: cob, cobv, cobr, loc, rec
│   └── auth/
│       ├── auth.ts             # Serviço Auth (valida contra owners)
│       └── models.ts
├── libs/
│   ├── fakedb.ts               # MemoryDB (clusterKey + sortKeys)
│   ├── messages.ts             # Mensagens de erro/validação
│   ├── documentos.ts           # Utilitários de CPF/CNPJ
│   └── utils.ts                # Utilitários gerais
├── validators/
│   └── custom-validators.ts    # Decorators customizados do class-validator
└── data/
    ├── db.json                 # owners (tokens) e correntistas (chaves Pix)
    └── municipios.json
```

Os testes ficam em `test/` (unitários em `test/controllers`, `test/core`, `test/libs`, `test/validators` e e2e em `test/*.e2e.test.ts`).

### 3.2 Padrão em camadas: Controller → PSP Service → MemoryDB

```
Requisição HTTP
     │
     ▼
HttpInterceptor ── valida header "mocked-token" e injeta IdOwner
     │
     ▼
Controller (cob/cobv/cobr/loc/rec) ── DTO validado (ValidationPipe)
     │
     ▼
PSP (core/app/psp.ts) ── txid, revisão, vínculo loc↔cob, paginação
     │
     ▼
MemoryDB (libs/fakedb.ts) ── coleções em memória por IdOwner
```

- **Controllers** apenas extraem `IdOwner` dos headers, montam um `PixRequest<T>` (`{ IdOwner, txid, data }`) e delegam ao serviço.
- **PSP** é o único *provider* do `AppModule` e concentra a lógica (`addCob`, `readCob`, `listCob`, `editCob`, `addCobV`, `addLoc`, `addRec` etc.).
- **MemoryDB** é um *singleton* por nome de coleção (`MemoryDB.create`/`MemoryDB.get`). Cada coleção guarda os registros por `clusterKey` (o `IdOwner`), garantindo isolamento entre PSPs/clientes, e exige ao menos uma *sort key* (ex.: `txid`, `id`, `uuid`, `chave`). As coleções `COB`, `LOCATIONS` e `CORRENTISTAS` são criadas no bootstrap; os dados de `correntistas` de `db.json` são carregados no cluster `DEV`.

### 3.3 Autenticação

O fluxo de autenticação é simulado em duas etapas:

1. **Obtenção do token (porta 3001)** — `POST /auth` com `grant_type=client_credentials`, `client_id` e `client_secret`. O serviço `Auth` monta o token como `` `${client_id}-${client_secret}` `` e verifica se ele existe em `owners` de `db.json` (ex.: `123-abc`, `456-def`). A resposta tem um atraso simulado de 2 s e retorna `{ accesstoken, expires_in: 300 }`.
2. **Uso do token (porta 3000)** — todos os controllers da API usam `@UseInterceptors(HttpInterceptor)`. O interceptor lê o header **`mocked-token`**, procura o *owner* correspondente e injeta `request.headers['IdOwner']`. Sem token válido retorna `401` no formato de erro do BACEN (`https://pix.bcb.gov.br/api/v2/error/AcessoNegado`).

O mesmo interceptor também:
- converte respostas vazias de `GET`/`PATCH`/`DELETE` em `404 NaoEncontrado`;
- converte erros `400` do `ValidationPipe` em `violacoes` no padrão BACEN (`CobOperacaoInvalida`, `CobVOperacaoInvalida`, `LocationOperacaoInvalida`, `RecOperacaoInvalida`).

Observação: o Swagger da API declara autenticação *Bearer* (`access-token`), mas a aplicação efetivamente lê apenas o header `mocked-token`.

## 4. Endpoints

### 4.1 API Pix — porta 3000

Todas as rotas exigem o header `mocked-token: <token>`.

#### `/cob` — Cobrança imediata (`CobController`)

| Método | Rota | Descrição |
|---|---|---|
| `PUT` | `/cob/:txid` | Cria cobrança imediata com `txid` informado |
| `POST` | `/cob` | Cria cobrança imediata com `txid` gerado (UUID sem hífens) |
| `GET` | `/cob/:txid` | Consulta cobrança (aceita `?revisao=`) |
| `GET` | `/cob` | Lista cobranças com filtros/paginação (`CobGetFilter`) |
| `PATCH` | `/cob/:txid` | Revisa cobrança |

#### `/cobv` — Cobrança com vencimento (`CobVController`)

| Método | Rota | Descrição |
|---|---|---|
| `PUT` | `/cobv/:txid` | Cria cobrança com vencimento |
| `GET` | `/cobv/:txid` | Consulta cobrança (aceita `?revisao=`) |
| `GET` | `/cobv` | Lista cobranças com filtros/paginação (`CobVGetFilter`) |
| `PATCH` | `/cobv/:txid` | Revisa cobrança |

#### `/cobr` — Cobrança recorrente (`CobRController`) — *não registrado no `AppModule`*

| Método | Rota | Descrição |
|---|---|---|
| `PUT` | `/cobr/:txid` | Cria cobrança recorrente (retorna `null`) |
| `POST` | `/cobr` | Cria cobrança recorrente com `txid` gerado (`PSP.addCobR` retorna `null`) |
| `POST` | `/cobr/:txid/retentativa/:data` | Solicita retentativa |
| `GET` | `/cobr/:txid` | Consulta cobrança (usa `readCob`) |
| `GET` | `/cobr` | Lista cobranças (usa `listCob`) |
| `PATCH` | `/cobr/:txid` | Revisa cobrança (usa `editCob`) |

#### `/rec` — Recorrências (`RecController`)

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/rec` | Cria recorrência; gera `idRec` a partir da política de retentativa, ISPB do owner e data |

#### `/loc` — Locations (`LocationController`)

| Método | Rota | Descrição |
|---|---|---|
| `PUT` | `/loc` | Cria location para o `tipoCob` informado |
| `GET` | `/loc/:id` | Consulta location |
| `GET` | `/loc` | Lista locations com filtros/paginação (`LocGetFilter`) |
| `DELETE` | `/loc/:id/txid` | Desvincula o `txid` da location |

### 4.2 Autenticação — porta 3001

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth` | Recebe `{ grant_type: "client_credentials", client_id, client_secret }` e retorna `{ accesstoken, expires_in }` |

Credenciais de exemplo (de `src/data/db.json`): `123`/`abc`, `456`/`def`, `789`/`ghi`.

## 5. Como executar

### 5.1 Localmente

Pré-requisito: Node.js 20.

```bash
npm install
npm run start:dev      # modo watch (nest start --watch)
# ou
npm run build && npm run start:prod
```

- API: <http://localhost:3000/api-docs>
- Auth: <http://localhost:3001/api-docs>

Exemplo de uso:

```bash
# 1. Obter token
curl -s -X POST http://localhost:3001/auth \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"123","client_secret":"abc"}'
# => {"accesstoken":"123-abc","expires_in":300}

# 2. Chamar a API com o token
curl -s http://localhost:3000/cob -H 'mocked-token: 123-abc'
```

### 5.2 Testes (Jest)

```bash
npm test               # jest (cobertura habilitada em jest.config.ts, saída em coverage/)
npm run test:watch
npm run test:cov
```

Os testes unitários e e2e (`*.test.ts` e `*.e2e.test.ts`) são encontrados pelo `testMatch` padrão do Jest via `jest.config.ts`. O script `npm run test:e2e` usa `test/jest-e2e.json`, cujo `testRegex` (`.e2e-spec.ts$`) não corresponde a nenhum arquivo do repositório.

### 5.3 Docker

O repositório contém um `dockerfile` (minúsculo) com *multi-stage build* (`node:20` para build e `node:20.16.0-alpine` como imagem final), expondo as portas 3000 e 3001:

```bash
docker build -f dockerfile -t pix-mocked-server .
docker run --rm -p 3000:3000 -p 3001:3001 pix-mocked-server
```

Também há um `.devcontainer/devcontainer.json` (imagem `node:20`, instala `@nestjs/cli` e dependências).

## 6. Pontos de atenção

1. **Rotas `GET` duplicadas em `cob`, `cobv` e `cobr` controllers.** Os métodos `remove()` de `CobController`, `CobVController` e `CobRController` estão decorados com `@Get(":txid")`, a mesma rota de `read()`. Como o Express resolve a primeira rota registrada, `remove()` é inalcançável — e, se a intenção era exclusão, o decorator deveria ser outro (ex.: `@Delete`) ou o método deveria ser removido, já que a API do BACEN não prevê exclusão de cobranças.

2. **`CobRController` não registrado no `AppModule`.** `src/app.module.ts` registra apenas `CobController`, `CobVController`, `LocationController` e `RecController`. Assim, nenhuma rota `/cobr` é exposta na porta 3000, embora existam controller e testes para ela.

3. **`PUT /cobr/:txid` retornando `null`.** O método `add()` de `CobRController` faz `return await null` (a chamada ao serviço está comentada). Além disso, `PSP.addCobR` também retorna `null`, e `GET`/`PATCH` de `cobr` reutilizam `readCob`/`listCob`/`editCob` de cobranças imediatas — a funcionalidade de cobrança recorrente está incompleta.

4. **Bug no interceptor ao não invocar `ServerErrorTypes`.** No `catchError` de `src/http.interceptor.ts`, o handler de `500` faz `new InternalServerErrorException(this.ServerErrorTypes[err.getStatus?.() || 500])` — a função não é invocada (faltam os parênteses) e não existe a chave `500` em `ServerErrorTypes`, resultando em corpo `undefined` em vez do erro padronizado. Relacionados:
   - `statusHandle` só trata `400`, `404` e `500`; qualquer outro status (ex.: `401`, `403`, `503`) resulta em `statusHandle` `undefined` e um `TypeError` ao chamá-lo;
   - no handler de `400`, endpoints sem entrada no mapa (ex.: `cobr`) também produzem `handle` `undefined`;
   - `src/main.ts` declara um objeto `ServerErrorTypes` que nunca é usado.

5. **Dockerfile usando `npm i` + `yarn build`.** O estágio `init` instala dependências com `npm i` (sem copiar `package-lock.json`, portanto sem build reprodutível) e o estágio `build` executa `yarn build`, misturando gerenciadores de pacote. Outros problemas no mesmo arquivo: `COPY src/ .` copia o conteúdo de `src/` para a raiz de `/app` (o `nest build` espera `src/`), a imagem final copia `node_modules` com dependências de desenvolvimento, e o nome do arquivo é `dockerfile` (minúsculo), exigindo `-f dockerfile` em alguns ambientes. Recomenda-se `COPY package*.json .` + `npm ci`, `npm run build` e `npm ci --omit=dev` na imagem final.

6. **Campo `accesstoken` fora do padrão OAuth2.** `AuthController` responde `{ accesstoken, expires_in }`, enquanto a RFC 6749 (seção 5.1) define `access_token` e `token_type` (ex.: `"Bearer"`) como obrigatórios. Clientes OAuth2 padrão não reconhecerão o token. Na mesma linha: `grant_type` inválido lança `Error` genérico (HTTP 500 em vez de `400 unsupported_grant_type`), credenciais inválidas também geram 500 (em vez de `401 invalid_client`), o DTO `ValidateInput` não tem decorators do `class-validator` e o `AuthModule` não registra `ValidationPipe`.

### Outros pontos observados

- `src/controllers/fakedb.ts` é uma cópia praticamente idêntica de `src/libs/fakedb.ts` e não é importada por nenhum arquivo.
- `src/controllers/webhook.controller.ts` está vazio.
- `LocationController` importa módulos com caminhos `../../src/...` em vez de caminhos relativos a `src/controllers`.
- `PUT /loc` diverge da especificação do BACEN, que usa `POST /loc` para criação de locations.
