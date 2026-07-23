<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/towk-horizontal-on-dark.webp" />
    <source media="(prefers-color-scheme: light)" srcset="branding/towk-horizontal-on-light.webp" />
    <img src="branding/towk-horizontal-on-light.webp" alt="Towk" width="520" />
  </picture>

  <h3>Comunicação open source sob o teu controlo.</h3>

  <p>
    Um espaço de comunicação autoalojado e focado no essencial para equipas e comunidades.<br />
    Salas, mensagens diretas, ficheiros, notificações, voz e vídeo — na infraestrutura que controlas.
  </p>

  <p>
    <a href="README.md">English</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.es.md">Español</a> ·
    <strong>Português</strong>
  </p>

  <p>
    <a href="https://github.com/Yo-DDV/Towk/releases/latest"><img src="https://img.shields.io/github/v/release/Yo-DDV/Towk?style=flat-square&amp;sort=semver&amp;display_name=tag&amp;label=release" alt="Versão mais recente" /></a>
    <a href="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml"><img src="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml/badge.svg?branch=main" alt="Verificação rápida" /></a>
    <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-policy-43d8b0?style=flat-square" alt="Política de segurança" /></a>
    <a href="LICENSING.md"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later%20%2B%20Apache--2.0-7867f2?style=flat-square" alt="Licença" /></a>
    <img src="https://img.shields.io/badge/status-pre--1.0-f59e0b?style=flat-square" alt="Estado pré-1.0" />
  </p>

  <p>
    <a href="#porquê-o-towk"><strong>Porquê o Towk</strong></a> ·
    <a href="#o-que-o-towk-oferece"><strong>Funcionalidades</strong></a> ·
    <a href="#soberania-na-prática"><strong>Soberania</strong></a> ·
    <a href="#segurança-com-limites-explícitos"><strong>Segurança</strong></a> ·
    <a href="#executa-o-à-tua-maneira"><strong>Implementação</strong></a> ·
    <a href="#experimenta-localmente"><strong>Início rápido</strong></a>
  </p>
</div>

> [!IMPORTANT]
> O Towk é software **pré-1.0 em desenvolvimento ativo**. Em implementações importantes, fixa uma versão, um digest de imagem ou um commit imutável; mantém cópias de segurança com restauros testados; e consulta as notas da versão antes de atualizar.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs-website/src/assets/towk_dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="apps/docs-website/src/assets/towk_light.png" />
  <img src="apps/docs-website/src/assets/towk_light.png" alt="Espaço de trabalho Towk com navegação de salas, conversa e diretório de membros" width="1440" />
</picture>

## Porquê o Towk

| 🧭 **Soberania desde o início** | 💬 **Comunicação focada** | 🔎 **Engenharia transparente** |
|---|---|---|
| Gere o servidor, o domínio, a identidade, o armazenamento, as cópias de segurança e o ritmo das atualizações. Não existe uma conta Towk central, um serviço alojado obrigatório ou análise de produto integrada. | O Towk concentra-se nos fluxos de comunicação quotidianos, em vez de crescer até se tornar numa suite universal cada vez mais complexa. | O código-fonte, os contratos de API, as decisões de arquitetura, os limites de segurança e a proveniência das versões são visíveis e auditáveis. |

O Towk foi criado para organizações e comunidades que querem colaboração moderna **sem entregar a um terceiro o controlo operacional e dos dados**. Cada servidor é independente; as suas contas e os dados da comunidade permanecem na infraestrutura e sob as regras escolhidas pelo operador.

A PWA instalável pode ligar-se diretamente a vários servidores Towk independentes. Assim, os utilizadores têm um único cliente sem criar uma identidade central, um plano de dados partilhado ou uma camada de federação.

## O que o Towk oferece

| | |
|---|---|
| **💬 Conversas estruturadas**<br />Salas, mensagens diretas, respostas, tópicos, reações, menções, pesquisa, presença e mudança rápida entre salas. | **📎 Conteúdo útil no dia a dia**<br />Ficheiros anexos, mensagens de voz, tratamento de imagens e vídeo opcional, pré-visualizações de ligações e entrega protegida de recursos. |
| **🔔 Atenção sem ruído desnecessário**<br />Notificações em tempo real, Web Push, distintivos, níveis de notificação por sala e navegação direta para a conversa relevante. | **🎙 Voz, vídeo e partilha de ecrã**<br />Chamadas LiveKit associadas a salas, com câmara, partilha de ecrã, controlos de dispositivos, recuperação de ligação e E2EE para os conteúdos multimédia. |
| **🧭 Uma única PWA adaptável**<br />Interfaces para computador e dispositivos móveis, orientação de instalação, shell offline, rascunhos e fila de envio locais cifrados, partilha do sistema e integrações progressivas com o dispositivo. | **🛡 Administração compreensível**<br />Funções integradas e personalizadas, permissões granulares, substituições por sala, gestão de membros, identidade visual do servidor, diagnósticos e registo de eventos administrativos. |
| **🌍 Interface multilingue**<br />O cliente atual mantém inglês, francês, alemão, espanhol e português. | **🔌 Superfície de integração aberta**<br />ConnectRPC e Protocol Buffers para as API públicas, além de um WebSocket protobuf para atualizações em tempo real. |

## Focado por conceção

O Towk não pretende transformar-se num mercado de extensões, numa rede social ou numa suite empresarial excessivamente abrangente. A sua direção de produto é deliberadamente mais concreta:

- tornar as conversas rápidas de abrir, ler e reencontrar;
- tornar as notificações úteis, em vez de excessivas;
- manter ficheiros, chamadas e administração próximos da sala onde o trabalho acontece;
- melhorar os fundamentos em computador, tablet e telemóvel sem dividir o produto em clientes divergentes;
- expor limitações e fronteiras de segurança, em vez de as esconder atrás de linguagem comercial.

Este foco faz parte do produto; não é uma falta temporária de ambição.

## Soberania na prática

| Tu escolhes | O Towk fornece |
|---|---|
| **Identidade** | Fluxos integrados de e-mail e palavra-passe ou fornecedores OAuth/OIDC externos. As contas permanecem locais a cada servidor. |
| **Camada de dados** | NATS integrado para instalações compactas ou NATS/JetStream externo para uma topologia mais explícita. |
| **Armazenamento de ficheiros** | NATS Object Store por predefinição, com armazenamento compatível com S3 para volumes de recursos maiores. |
| **Chamadas** | Integração LiveKit opcional. A interface de chamadas desaparece quando o LiveKit não está configurado. |
| **Acesso do cliente** | Uma PWA fornecida pelo navegador que se liga diretamente aos servidores adicionados pelo utilizador. |
| **Operação** | Ferramentas CLI, caminhos de cópia de segurança e exportação de chaves, métricas compatíveis com Prometheus, artefactos de versão imutáveis e expectativas de reversão documentadas. |

O Towk **não é federado**: os servidores não trocam dados das respetivas comunidades. Cada implementação mantém a sua própria fronteira administrativa e de proteção de dados.

O autoalojamento não cria conformidade por si só, mas dá aos operadores o controlo necessário para alinhar a localização do alojamento, a identidade, o armazenamento, as cópias de segurança e as políticas de acesso com os seus requisitos.

## Segurança com limites explícitos

O Towk procura tornar as decisões de segurança inspecionáveis, em vez de formular promessas absolutas.

| Limite | Abordagem atual |
|---|---|
| **Autorização** | Aplicação nos limites da API através de funções RBAC integradas e personalizadas, concessões e recusas explícitas, substituições por sala e recuperação do proprietário. |
| **Sessões** | Credenciais opacas armazenadas no servidor, cookies do navegador assinados, revogação através da eliminação do estado de execução e limites de tentativas de autenticação. |
| **Campos persistentes protegidos** | O texto das mensagens e alguns campos de conta são cifrados antes do armazenamento persistente com material de chave por utilizador. |
| **Transporte e superfície do navegador** | Suporte HTTPS, cabeçalhos de resposta restritivos, verificações de origem, tamanhos de pedido limitados e entrega protegida de recursos. |
| **Cópias de segurança e operação** | Arquivos opcionalmente cifrados com age, tratamento separado de chaves, automatização privada do operador através de socket Unix e monitorização compatível com Prometheus. |

> [!NOTE]
> O Towk não oferece cifragem ponto a ponto generalizada para mensagens normais. O servidor em execução tem de decifrar os campos protegidos para clientes autorizados. Os anexos, avatares e uma parte significativa dos metadados ficam fora do envelope de cifragem da aplicação e necessitam de proteção ao nível da infraestrutura. Os conteúdos multimédia de voz e vídeo podem utilizar o E2EE do LiveKit.

Consulta o modelo exato antes de avaliar o Towk para utilizações sensíveis:

- [Política de segurança](SECURITY.md)
- [Guia de segurança e privacidade](apps/docs-website/src/content/docs/guides/operations/security.mdx)
- [Cifragem em repouso e eliminação de dados](apps/docs-website/src/content/docs/guides/operations/privacy-erasure.mdx)
- [Cópias de segurança e restauro](apps/docs-website/src/content/docs/guides/operations/backup-restore.mdx)

## Executa-o à tua maneira

| Caminho | Melhor utilização | Composição |
|---|---|---|
| **Binário único** | Avaliação, equipas pequenas e máquinas virtuais simples | Cliente web, API e NATS integrados num processo compacto. |
| **Docker Compose** | A maioria dos servidores autoalojados | Towk com NATS explícito, Caddy e LiveKit opcional no mesmo anfitrião. |
| **Kubernetes / serviços externos** | Operadores com uma plataforma existente | NATS externo, armazenamento compatível com S3, LiveKit e várias réplicas Towk quando a infraestrutura envolvente está qualificada. |

O Towk não necessita de MySQL nem PostgreSQL. O estado persistente da aplicação assenta em NATS JetStream e projeções, enquanto o cliente web é compilado na distribuição do servidor Go.

## Experimenta localmente

O Towk utiliza [mise](https://mise.jdx.dev/) para fornecer a sua cadeia de ferramentas de desenvolvimento fixada.

```sh
git clone https://github.com/Yo-DDV/Towk.git
cd Towk
mise trust
mise run setup
mise dev
```

Abre <http://localhost:4000>.

Este caminho de desenvolvimento utiliza dados de inicialização locais. Nunca reutilizes credenciais ou valores predefinidos de desenvolvimento numa implementação pública.

Para uma implementação duradoura, começa por:

- [Introdução](apps/docs-website/src/content/docs/getting-started/introduction.mdx)
- [Início rápido](apps/docs-website/src/content/docs/getting-started/quick-start.mdx)
- [Ler antes de implementar](apps/docs-website/src/content/docs/guides/deployment/read-this-first.mdx)
- [Arquitetura](docs/ARCHITECTURE.md)

## Estado do projeto e expectativas

O Towk é mantido como um projeto independente, público e pré-1.0.

- As API públicas e os contratos de implementação ainda podem evoluir durante a série `0.x`.
- As implementações importantes devem usar versões imutáveis e procedimentos de restauro testados.
- A PWA é o cliente atual para computador e dispositivos móveis; não existem atualmente pacotes publicados em lojas de aplicações.
- O Towk não oferece atualmente uma edição alojada nem um plano de suporte comercial.
- Os erros, as propostas de funcionalidades focadas e as questões de autoalojamento são tratados através das [Issues do GitHub](https://github.com/Yo-DDV/Towk/issues/new/choose).
- As vulnerabilidades devem ser comunicadas em privado de acordo com [SECURITY.md](SECURITY.md).

O roteiro baseia-se em provas: o trabalho concluído deve existir no repositório, enquanto o trabalho planeado continua sujeito a conceção e validação. Consulta [ROADMAP.md](ROADMAP.md).

## Documentação e registos do projeto

| Necessidade | Referência |
|---|---|
| Introdução ao produto e implementação | [Fontes da documentação](apps/docs-website/src/content/docs/) |
| Arquitetura e API | [Inventário de arquitetura](docs/ARCHITECTURE.md) · [ADR](docs/adr/INDEX.md) · [FDR](docs/fdr/INDEX.md) |
| Operação e segurança | [Segurança](SECURITY.md) · [Suporte](SUPPORT.md) · [Qualificação de desempenho](docs/PERFORMANCE.md) |
| Processo do projeto | [Governação](GOVERNANCE.md) · [Guia de participação](CONTRIBUTING.md) · [Roteiro](ROADMAP.md) |
| Origem e compatibilidade | [Proveniência](PROVENANCE.md) · [Política upstream](UPSTREAM.md) · [Código-fonte correspondente](SOURCE.md) |

## Licença e origem

O Towk preserva o modelo de licenciamento por ficheiro do repositório:

- o servidor, a CLI e a distribuição empacotada do servidor são geralmente disponibilizados sob **AGPL-3.0-or-later**;
- as áreas explicitamente identificadas do frontend, das API públicas, da documentação e dos exemplos são disponibilizadas sob **Apache-2.0**;
- o limite exato e legível por máquina está definido em [REUSE.toml](REUSE.toml), com avisos de terceiros em [NOTICE](NOTICE).

O Towk é um projeto independente baseado no [Chatto](https://github.com/chattocorp/chatto). Preserva a autoria, os avisos e os contratos de compatibilidade do upstream, enquanto toma as suas próprias decisões de produto, versões e suporte. O Towk não é apoiado, patrocinado, operado nem suportado pela ChattoCorp GmbH.
