# Greencode

Sistema de logística reversa para organizações, contratos, lotes e equipamentos. O Greencode registra a entrada de equipamentos, acompanha sua triagem, desmontagem, reaproveitamento, reciclagem ou descarte, e mantém o histórico das operações.

## O que o sistema faz

- Gerencia organizações e seus contratos.
- Registra lotes recebidos e os equipamentos associados.
- Controla triagem, estado físico, status de rastreamento e movimentações.
- Preserva histórico, correções, estornos e eventos de auditoria.
- Gera relatórios operacionais, por organização, financeiros e de auditoria.
- Controla acesso por usuário e papel.
- Calcula análises de eficiência, rentabilidade e vida útil remanescente.
- Registra valores observados de recuperação e eventos de falha para análises históricas.
- Expõe uma API pública versionada com chaves de API e permissões.
- Processa relatórios públicos em filas BullMQ com PostgreSQL.

## Duas formas de uso

O projeto oferece uma CLI conectada à API por padrão, uma CLI local opcional e uma API REST. A CLI conectada compartilha contas e dados com o PostgreSQL. A CLI local guarda registros separados em arquivos cifrados dentro de `data/`.

Para usar o CLI conectado, inicie a API com `npm start` e, em outro terminal, execute `npm run start:cli`. O endereço padrão é `http://127.0.0.1:3000`; configure `API_BASE_URL` se a API estiver em outro endereço. Entre com uma conta cadastrada na API. Para usar o modo local, execute `npm run start:cli:local`.

A API não inclui uma interface web própria. A página `/documentation` fornece a documentação interativa Swagger para consultar e chamar os endpoints.

## Documentação

- [Instalação e configuração](docs/INSTALACAO.md)
- [Manual do usuário — CLI](docs/MANUAL_CLI.md)
- [Manual do usuário — API](docs/MANUAL_API.md)
- [Segurança e testes](docs/SEGURANCA_E_TESTES.md)
- [Relatório técnico da AV3](RELATORIO_TECNICO_AV3.md)

## Recursos da AV3

- `POST /analyses/efficiency`, `POST /analyses/profitability` e `POST /analyses/remaining-life`: executam e persistem análises internas.
- `GET /analyses` e `GET /analyses/:id`: consultam resultados históricos.
- `/api/v1/public`: rastreamento, lotes e análises para parceiros externos autenticados por `X-API-Key`.
- `/api/v1/admin/partners` e `/api/v1/admin/partners/:id/keys`: gestão administrativa de parceiros e chaves.
- `/api/v1/public/reports/async`, `GET /api/v1/public/reports/:id/status` e `GET /api/v1/public/reports/:id/download`: relatórios assíncronos em JSON ou CSV.
- `POST /equipment/:id/recoveries` e `POST /equipment/:id/failures`: registros auditáveis para alimentar análises com dados observados.

Configure PostgreSQL e as variáveis conforme [Instalação e configuração](docs/INSTALACAO.md). A fila BullMQ usa um schema PostgreSQL próprio e não requer Redis ou WSL. A fila é ativada junto com a API quando `DATABASE_URL` está configurada; use `ASYNC_REPORTS_ENABLED=false` para desativá-la. `ASYNC_REPORT_DB_POOL_MAX` ajusta o pool de conexões por instância BullMQ.

## Tecnologias

Node.js, TypeScript, Fastify, Prisma e PostgreSQL (API). A CLI usa armazenamento local cifrado com AES-256-GCM.
