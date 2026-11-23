# Segurança e testes

## Controles de segurança

### CLI local

A CLI local armazena seus dados em `data/`, cifrados com AES-256-GCM. Cada gravação usa IV aleatório e tag de autenticação; a substituição do arquivo é atômica. A chave mestra é protegida com uma chave derivada por `scrypt` da senha de desbloqueio. O histórico de comandos é persistido no repositório cifrado e comandos com campos de senha são descartados.

### API e autenticação

A API emite JWT Bearer com prazo padrão de 30 minutos, configurável por `JWT_EXPIRES_IN`. O segredo é configurado em `JWT_SECRET`. Em cada requisição autenticada, a API verifica a credencial ativa e usa o papel atual registrado no PostgreSQL para autorizar a operação. A desativação de uma credencial bloqueia o acesso.

As senhas são armazenadas como hash SHA-256 com salt aleatório por usuário. As chaves da API pública são exibidas integralmente somente na criação; o banco mantém o hash. Chaves expiradas ou revogadas são rejeitadas. As permissões restringem os endpoints e o escopo de dados à organização do parceiro. Há limite de requisições configurável por chave.

As operações mutáveis registram auditoria com a alteração na mesma transação quando executadas pelos serviços Prisma. A API não expõe hashes ou salts de credenciais e sanitiza mensagens internas em respostas de erro.

### Banco e relatórios

O schema da aplicação é gerenciado por migrações Prisma em `prisma/migrations/`. A fila BullMQ usa PostgreSQL no schema `bullmq`; relatórios são armazenados em `reports/`. O acesso a status e download valida o proprietário da tarefa.

## Verificações realizadas

Na revisão final, com PostgreSQL local conectado:

- `npm run db:validate`: schema Prisma válido.
- `npm run db:migrate:status`: 13 migrações aplicadas e schema atualizado.
- `npm run build`: compilação concluída.
- `npm test`: 60 testes aprovados, nenhuma falha e nenhum teste ignorado.
- A fila BullMQ foi verificada com processamento concorrente, retry, falha terminal e retomada após reinício do worker.
- A API pública foi verificada com leitura de lotes e rastreamento, isolamento entre organizações, criação de lote com equipamento e geração/consulta/download de relatórios JSON e CSV.

Os registros temporários criados para a verificação prática foram removidos depois da execução. Os dados `SEED-*` do banco são sintéticos.

## Limites funcionais documentados

- A CLI local e a API PostgreSQL mantêm armazenamentos separados; os dados da CLI não são importados automaticamente.
- A API e o worker de relatórios executam no mesmo processo. O acompanhamento dos relatórios usa polling.
- Arquivos de relatório ficam no diretório local `reports/`.
- A rentabilidade mostra valores observados por moeda e referência de depreciação separadamente; não calcula lucro líquido nem desconta custos.
- A vida útil remanescente é uma estimativa que depende da quantidade e qualidade dos dados registrados.
- Não há interface web. A rota `/documentation` disponibiliza Swagger para a API.

## Comandos da CLI local

```text
login USUARIO --senha SENHA
org criar --id ID --razao "RAZÃO" --cnpj CNPJ
lote criar --id ID --org ORG --nf NF --transp TRANSPORTADORA
equip criar --id ID --lote LOTE --tipo TIPO --marca MARCA --modelo MODELO --ano ANO --estado ESTADO --peso KG
lote triagem --id LOTE
equip mover --id EQUIPAMENTO --destino DESTINO
rastrear EQUIPAMENTO
relatorio status --status STATUS
```

Use `ajuda` dentro da aplicação para consultar os comandos e valores aceitos.
