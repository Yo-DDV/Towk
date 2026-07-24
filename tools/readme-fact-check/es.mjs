import { BASELINE_SHA } from "./core.mjs";

export default {
  file: "README.es.md",
  summary: "Cómo se generan estas métricas",
  contributorAlt: "Autores de commits y pull requests fusionadas de Towk desde la fundación pública del repositorio independiente",
  body: `  El propio repositorio genera estos SVG a partir de la API de GitHub con su
  \`GITHUB_TOKEN\` limitado al repositorio; no utiliza un token personal ni un
  servicio externo de estadísticas. El workflow se ejecuta después de cada push
  a \`main\` y está programado aproximadamente a las **06:17 y 21:17 en la zona
  horaria Europe/Paris**, cada día.

  Los contadores principales y las clasificaciones comienzan después del commit
  público que fundó el repositorio independiente \`${BASELINE_SHA}\`, fusionado el
  12 de julio de 2026. Así, el historial heredado de Chatto no se presenta como
  progreso actual de Towk. Los gráficos mantienen ventanas móviles de 30 días,
  12 semanas y 12 meses; los periodos anteriores a esa fundación aparecen con
  actividad cero. Los commits se seleccionan topológicamente desde \`main\` después
  del commit de fundación y se agrupan por su marca temporal de commit en UTC. Las
  pull requests se cuentan por \`merged_at\` después del instante de fundación. Las
  clasificaciones usan el usuario de GitHub cuando está disponible y, en caso
  contrario, el nombre público del autor del commit. Los bots detectados se
  excluyen de las clasificaciones humanas y se muestran por separado. Estas cifras
  describen la actividad del repositorio y la atribución de Git, no el esfuerzo
  individual. Los mensajes de commit y las direcciones de correo electrónico no
  se escriben en la rama generada.

  Los SVG y la instantánea legible por máquina se publican en la rama
  [\`readme-metrics\`](https://github.com/Yo-DDV/Towk/tree/readme-metrics).`,
  replacements: [
    [
      `> Towk está en desarrollo activo y aún no ha alcanzado la versión 1.0. Para
> despliegues importantes, fija una versión o un digest de imagen inmutable,
> conserva copias de seguridad cuya restauración hayas probado y revisa las
> notas de versión antes de actualizar.`,
      `> Towk está en desarrollo activo y aún no ha alcanzado la versión 1.0. Para
> despliegues importantes, fija el digest exacto de la imagen o el commit de origen,
> conserva copias de seguridad cuya restauración hayas probado y revisa las notas
> de versión y los cambios de configuración antes de actualizar.`
    ],
    [
      `<p><strong>Los fundamentos merecen atención de primera clase.</strong> Towk prioriza conversaciones, archivos, notificaciones y llamadas en lugar de convertirse en una plataforma para todo.</p>`,
      `<p><strong>Las funciones esenciales merecen una atención prioritaria.</strong> Towk prioriza conversaciones, archivos, notificaciones y llamadas en lugar de convertirse en una plataforma para todo.</p>`
    ],
    [
      `<p>Salas de voz/vídeo opcionales con LiveKit, pantalla compartida, E2EE de los medios de llamada y una PWA adaptable e instalable.</p>`,
      `<p>Llamadas de voz y vídeo opcionales con LiveKit, pantalla compartida, E2EE de los medios de llamada y una PWA adaptable e instalable.</p>`
    ],
    [
      `<p>Flujos de contraseña/correo, OIDC y proveedores OAuth seleccionados, además de borradores, bandeja de salida e historiales recientes cifrados en navegadores compatibles.</p>`,
      `<p>Flujos de contraseña/correo, OIDC y proveedores OAuth seleccionados, además de borradores, bandeja de salida e historiales recientes de salas cifrados en navegadores compatibles.</p>`
    ],
    [
      `La interfaz está disponible en **inglés, alemán, francés, español y portugués**.
El comportamiento detallado, las decisiones y las limitaciones actuales están
documentados en los [Feature Decision Records](docs/fdr/INDEX.md).`,
      `La interfaz está disponible en **inglés, alemán, francés, español y portugués**.
El comportamiento detallado, las decisiones y las limitaciones actuales están
documentados en los [Feature Decision Records](docs/fdr/INDEX.md). La documentación
técnica enlazada se mantiene actualmente en inglés.`
    ],
    [
      `<td width="33%" valign="top"><h3>🏠 Despliegue</h3><p>Opera un servidor independiente por organización o comunidad, desde un binario compacto hasta un despliegue con réplicas.</p></td>`,
      `<td width="33%" valign="top"><h3>🏠 Despliegue</h3><p>Cada despliegue sirve a una organización o comunidad, desde un binario compacto hasta una topología con réplicas.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📦 Trazabilidad de las compilaciones</h3><p>Código público, coordenadas inmutables, metadatos OCI del commit exacto, SBOM, análisis de vulnerabilidades y atestaciones de procedencia.</p></td>`,
      `<td width="33%" valign="top"><h3>📦 Trazabilidad de las compilaciones</h3><p>Código público, metadatos OCI del commit exacto, digests de imagen, SBOM, análisis de vulnerabilidades y atestaciones de procedencia.</p></td>`
    ],
    [
      `<td width="33%" valign="top"><h3>📈 Visibilidad operativa</h3><p>Endpoints de salud y disponibilidad, métricas compatibles con Prometheus, diagnósticos, registro administrativo y controles de rendimiento reproducibles.</p></td>`,
      `<td width="33%" valign="top"><h3>📈 Visibilidad operativa</h3><p>Endpoints de salud y disponibilidad, métricas compatibles con Prometheus, diagnósticos, registro administrativo y un protocolo reproducible de evaluación del rendimiento multimedia.</p></td>`
    ],
    [
      `> metadatos quedan fuera de esa envoltura. Los medios de las llamadas LiveKit
> admiten E2EE cuando las llamadas están habilitadas.`,
      `> metadatos quedan fuera de esa envoltura. Los medios de las llamadas LiveKit
> usan E2EE cuando las llamadas están habilitadas, pero Towk proporciona la clave
> compartida de la llamada; un operador de Towk con acceso a esas claves sigue
> dentro del perímetro de confianza de la llamada.`
    ],
    [
      `Para despliegues duraderos, usa una etiqueta de imagen inmutable junto con su
digest, no una etiqueta flotante.`,
      `Para despliegues duraderos, fija un digest de imagen exacto en lugar de confiar
en una etiqueta flotante.`
    ]
  ],
  required: [
    "ni** un protocolo federado",
    "no ofrece cifrado de extremo a extremo para conversaciones",
    "perímetro de confianza de la llamada",
    "fundó el repositorio independiente",
    "usuario de GitHub cuando está disponible",
    "no el esfuerzo individual",
    "documentación\ntécnica enlazada"
  ]
};
