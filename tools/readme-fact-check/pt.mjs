import { BASELINE_SHA } from "./core.mjs";

export default {
  file: "README.pt.md",
  summary: "Como estas métricas são produzidas",
  contributorAlt: "Autores dos commits e pull requests integradas do Towk desde a criação pública do repositório independente",
  body: `  O próprio repositório gera estes SVG a partir da API do GitHub com o seu
  \`GITHUB_TOKEN\` limitado ao repositório; não usa um token pessoal nem um serviço
  externo de estatísticas. O workflow é executado depois de cada push para \`main\`
  e está agendado aproximadamente para as **06:17 e 21:17 no fuso horário
  Europe/Paris**, todos os dias.

  Os contadores principais e as classificações começam depois do commit público
  que criou o repositório independente \`${BASELINE_SHA}\`, integrado em 12 de julho
  de 2026. Assim, o histórico herdado do Chatto não é apresentado como progresso
  atual do Towk. Os gráficos mantêm janelas móveis de 30 dias, 12 semanas e 12
  meses; os períodos anteriores a essa criação aparecem com atividade zero. Os
  commits são selecionados topologicamente a partir de \`main\` depois do commit de
  criação e agrupados pelo respetivo carimbo temporal de commit em UTC. As pull
  requests são contadas por \`merged_at\` depois do instante de criação. As
  classificações usam o nome de utilizador do GitHub quando está disponível e, caso
  contrário, o nome público do autor do commit. Os bots detetados são excluídos das
  classificações humanas e apresentados separadamente. Estes números descrevem a
  atividade do repositório e a atribuição Git, não o esforço individual. As
  mensagens de commit e os endereços de correio eletrónico não são escritos no ramo
  gerado.

  Os SVG e o instantâneo legível por máquina são publicados no ramo
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`,
  replacements: [
    [
      `> O Towk está em desenvolvimento ativo e ainda não chegou à versão 1.0. Para
> instalações importantes, fixa uma versão ou um digest de imagem imutável,
> mantém cópias de segurança com restauros testados e consulta as notas de versão
> antes de atualizar.`,
      `> O Towk está em desenvolvimento ativo e ainda não chegou à versão 1.0. Para
> instalações importantes, fixa o digest exato da imagem ou o commit de origem,
> mantém cópias de segurança com restauros testados e consulta as notas de versão
> e as alterações de configuração antes de atualizar.`
    ],
    [
      `<p><strong>Os fundamentos merecem atenção de primeira classe.</strong> O Towk dá prioridade a conversas, ficheiros, notificações e chamadas em vez de se tornar uma plataforma para tudo.</p>`,
      `<p><strong>As funções essenciais merecem atenção especial.</strong> O Towk dá prioridade a conversas, ficheiros, notificações e chamadas em vez de se tornar uma plataforma para tudo.</p>`
    ],
    [
      `> **O autoalojamento não é uma caixa para assinalar.** Significa escolher onde o`,
      `> **O autoalojamento é mais do que uma opção numa lista de funcionalidades.** Significa escolher onde o`
    ],
    [
      `<p>Salas de voz/vídeo opcionais com LiveKit, partilha de ecrã, E2EE dos conteúdos das chamadas e uma PWA responsiva e instalável.</p>`,
      `<p>Chamadas de voz e vídeo opcionais com LiveKit, partilha de ecrã, cifragem ponta a ponta dos fluxos multimédia das chamadas e uma PWA responsiva e instalável.</p>`
    ],
    [
      `<p>Fluxos por palavra-passe/correio, OIDC e fornecedores OAuth selecionados, além de rascunhos, caixa de saída e históricos recentes cifrados em browsers compatíveis.</p>`,
      `<p>Fluxos por palavra-passe/correio, OIDC e fornecedores OAuth selecionados, além de rascunhos, caixa de saída e históricos recentes de salas cifrados em navegadores compatíveis.</p>`
    ],
    [
      `<p>API ConnectRPC baseadas em Protobuf, frames WebSocket em tempo real, CLI/API de operador, endpoints de saúde, métricas e cliente multisservidor.</p>`,
      `<p>API ConnectRPC baseadas em Protobuf, tramas WebSocket em tempo real, CLI/API de operador, endpoints de saúde, métricas e cliente multisservidor.</p>`
    ],
    [
      `A interface está disponível em **inglês, alemão, francês, espanhol e português**.
O comportamento detalhado, os compromissos e as limitações atuais estão registados
nos [Feature Decision Records](docs/fdr/INDEX.md).`,
      `A interface está disponível em **inglês, alemão, francês, espanhol e português**.
O comportamento detalhado, os compromissos e as limitações atuais estão registados
nos [Feature Decision Records](docs/fdr/INDEX.md). A documentação técnica associada
é atualmente mantida em inglês.`
    ],
    [
      `<td width="33%" valign="top"><h3>🏠 Implantação</h3><p>Opera um servidor independente por organização ou comunidade, desde um binário compacto até uma instalação com réplicas.</p></td>`,
      `<td width="33%" valign="top"><h3>🏠 Implantação</h3><p>Cada instalação serve uma organização ou comunidade, desde um binário compacto até uma topologia com réplicas.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📦 Rastreabilidade das compilações</h3><p>Código público, coordenadas imutáveis, metadados OCI do commit exato, SBOM, análises de vulnerabilidades e atestados de proveniência.</p></td>`,
      `<td width="33%" valign="top"><h3>📦 Rastreabilidade das compilações</h3><p>Código público, metadados OCI do commit exato, digests de imagem, SBOM, análises de vulnerabilidades e atestados de proveniência.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📈 Visibilidade operacional</h3><p>Endpoints de saúde e prontidão, métricas compatíveis com Prometheus, diagnósticos, registo administrativo e controlos de desempenho reproduzíveis.</p></td>`,
      `<td width="33%" valign="top"><h3>📈 Visibilidade operacional</h3><p>Endpoints de saúde e prontidão, métricas compatíveis com Prometheus, diagnósticos, registo administrativo e um protocolo reproduzível de qualificação do desempenho multimédia.</p></td>`
    ],
    [
      `> fora dessa envolvente. Os conteúdos das chamadas LiveKit suportam E2EE quando
> as chamadas estão ativadas.`,
      `> fora dessa envolvente. Os fluxos multimédia das chamadas LiveKit usam cifragem
> ponta a ponta quando as chamadas estão ativadas, mas o Towk fornece a chave
> partilhada da chamada; um operador do Towk com acesso a essas chaves continua
> dentro do perímetro de confiança da chamada.`
    ],
    [
      `Para instalações duradouras, usa uma etiqueta de imagem imutável acompanhada do
respetivo digest, não uma etiqueta flutuante.`,
      `Para instalações duradouras, fixa um digest de imagem exato em vez de confiares
numa etiqueta flutuante.`
    ]
  ],
  required: [
    "nem** um protocolo federado",
    "não oferece cifragem ponta a ponta para conversas",
    "perímetro de confiança da chamada",
    "que criou o repositório independente",
    "nome de utilizador do GitHub quando está disponível",
    "não o esforço individual",
    "documentação técnica associada"
  ]
};
