<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/towk-horizontal-on-dark.webp" />
    <source media="(prefers-color-scheme: light)" srcset="branding/towk-horizontal-on-light.webp" />
    <img src="branding/towk-horizontal-on-light.webp" alt="Towk" width="520" />
  </picture>

  <h3>Comunicación de código abierto, bajo tu control.</h3>

  <p>
    Un espacio de comunicación autoalojado y centrado en lo esencial para equipos y comunidades.<br />
    Salas, mensajes directos, archivos, notificaciones, voz y vídeo — en la infraestructura que tú controlas.
  </p>

  <p>
    <a href="README.md">English</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <strong>Español</strong> ·
    <a href="README.pt.md">Português</a>
  </p>

  <p>
    <a href="https://github.com/Yo-DDV/Towk/releases/latest"><img src="https://img.shields.io/github/v/release/Yo-DDV/Towk?style=flat-square&amp;sort=semver&amp;display_name=tag&amp;label=release" alt="Última versión" /></a>
    <a href="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml"><img src="https://github.com/Yo-DDV/Towk/actions/workflows/quick-gate.yml/badge.svg?branch=main" alt="Control rápido" /></a>
    <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-policy-43d8b0?style=flat-square" alt="Política de seguridad" /></a>
    <a href="LICENSING.md"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later%20%2B%20Apache--2.0-7867f2?style=flat-square" alt="Licencia" /></a>
    <img src="https://img.shields.io/badge/status-pre--1.0-f59e0b?style=flat-square" alt="Estado pre-1.0" />
  </p>

  <p>
    <a href="#por-qué-towk"><strong>Por qué Towk</strong></a> ·
    <a href="#lo-que-ofrece-towk"><strong>Funciones</strong></a> ·
    <a href="#soberanía-en-la-práctica"><strong>Soberanía</strong></a> ·
    <a href="#seguridad-con-límites-explícitos"><strong>Seguridad</strong></a> ·
    <a href="#ejecútalo-a-tu-manera"><strong>Despliegue</strong></a> ·
    <a href="#pruébalo-en-local"><strong>Inicio rápido</strong></a>
  </p>
</div>

> [!IMPORTANT]
> Towk es software **pre-1.0 en desarrollo activo**. En despliegues importantes, fija una versión, un digest de imagen o un commit inmutable; conserva copias de seguridad cuya restauración hayas probado; y revisa las notas de la versión antes de actualizar.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs-website/src/assets/towk_dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="apps/docs-website/src/assets/towk_light.png" />
  <img src="apps/docs-website/src/assets/towk_light.png" alt="Espacio de trabajo Towk con navegación de salas, conversación y directorio de miembros" width="1440" />
</picture>

## Por qué Towk

| 🧭 **Soberanía desde el principio** | 💬 **Comunicación centrada** | 🔎 **Ingeniería transparente** |
|---|---|---|
| Gestiona el servidor, el dominio, la identidad, el almacenamiento, las copias de seguridad y el ritmo de las actualizaciones. No hay una cuenta Towk central, un servicio alojado obligatorio ni analítica de producto integrada. | Towk se centra en los flujos de comunicación cotidianos en lugar de crecer hasta convertirse en una suite universal cada vez más compleja. | El código fuente, los contratos de API, las decisiones de arquitectura, los límites de seguridad y la procedencia de las versiones son visibles y auditables. |

Towk está pensado para organizaciones y comunidades que quieren una colaboración moderna **sin ceder a un tercero el control operativo y de los datos**. Cada servidor es independiente; sus cuentas y los datos de la comunidad permanecen en la infraestructura y bajo las normas elegidas por su operador.

La PWA instalable puede conectarse directamente a varios servidores Towk independientes. Así, los usuarios disponen de un único cliente sin crear una identidad central, un plano de datos compartido ni una capa de federación.

## Lo que ofrece Towk

| | |
|---|---|
| **💬 Conversaciones estructuradas**<br />Salas, mensajes directos, respuestas, hilos, reacciones, menciones, búsqueda, presencia y cambio rápido entre salas. | **📎 Contenido útil para el día a día**<br />Archivos adjuntos, mensajes de voz, tratamiento de imágenes y vídeo opcional, vistas previas de enlaces y entrega protegida de recursos. |
| **🔔 Atención sin ruido innecesario**<br />Notificaciones en tiempo real, Web Push, insignias, niveles de notificación por sala y navegación directa a la conversación relevante. | **🎙 Voz, vídeo y pantalla compartida**<br />Llamadas LiveKit asociadas a salas, con cámara, pantalla compartida, control de dispositivos, recuperación de la conexión y E2EE para los medios. |
| **🧭 Una única PWA adaptable**<br />Diseños para escritorio y móvil, ayuda de instalación, shell sin conexión, borradores y cola de salida locales cifrados, uso compartido del sistema e integraciones progresivas con el dispositivo. | **🛡 Administración comprensible**<br />Roles integrados y personalizados, permisos granulares, excepciones por sala, gestión de miembros, identidad visual del servidor, diagnósticos y registro de eventos administrativos. |
| **🌍 Interfaz multilingüe**<br />El cliente actual mantiene inglés, francés, alemán, español y portugués. | **🔌 Superficie de integración abierta**<br />ConnectRPC y Protocol Buffers para las API públicas, además de un WebSocket protobuf para las actualizaciones en tiempo real. |

## Centrado por diseño

Towk no pretende convertirse en un mercado de extensiones, una red social o una suite empresarial desmesurada. Su dirección de producto es deliberadamente más concreta:

- hacer que las conversaciones sean rápidas de abrir, leer y volver a encontrar;
- hacer que las notificaciones sean útiles en vez de abrumadoras;
- mantener los archivos, las llamadas y la administración cerca de la sala donde ocurre el trabajo;
- mejorar los fundamentos en escritorio, tableta y móvil sin dividir el producto en clientes divergentes;
- exponer las limitaciones y las fronteras de seguridad en vez de ocultarlas tras lenguaje comercial.

Este enfoque forma parte del producto; no es una falta temporal de ambición.

## Soberanía en la práctica

| Tú eliges | Towk proporciona |
|---|---|
| **Identidad** | Flujos integrados de correo electrónico y contraseña o proveedores OAuth/OIDC externos. Las cuentas permanecen locales a cada servidor. |
| **Capa de datos** | NATS integrado para instalaciones compactas o NATS/JetStream externo para una topología más explícita. |
| **Almacenamiento de archivos** | NATS Object Store de forma predeterminada, con almacenamiento compatible con S3 para volúmenes de recursos mayores. |
| **Llamadas** | Integración LiveKit opcional. La interfaz de llamadas desaparece cuando LiveKit no está configurado. |
| **Acceso del cliente** | Una PWA distribuida por el navegador que se conecta directamente a los servidores añadidos por el usuario. |
| **Operación** | Herramientas CLI, rutas de copia de seguridad y exportación de claves, métricas compatibles con Prometheus, artefactos de versión inmutables y expectativas de reversión documentadas. |

Towk **no está federado**: los servidores no intercambian los datos de sus comunidades. Cada despliegue conserva su propia frontera administrativa y de protección de datos.

El autoalojamiento no crea cumplimiento normativo por sí solo, pero proporciona a los operadores el control necesario para adaptar la ubicación del alojamiento, la identidad, el almacenamiento, las copias de seguridad y las políticas de acceso a sus propios requisitos.

## Seguridad con límites explícitos

Towk busca que las decisiones de seguridad puedan inspeccionarse, en lugar de formular promesas absolutas.

| Límite | Enfoque actual |
|---|---|
| **Autorización** | Aplicación en los límites de la API con roles RBAC integrados y personalizados, concesiones y denegaciones explícitas, excepciones por sala y recuperación del propietario. |
| **Sesiones** | Credenciales opacas almacenadas en el servidor, cookies de navegador firmadas, revocación mediante la eliminación del estado de ejecución y límites de intentos de autenticación. |
| **Campos persistentes protegidos** | El texto de los mensajes y determinados campos de cuenta se cifran antes del almacenamiento persistente con material de clave por usuario. |
| **Transporte y superficie del navegador** | Compatibilidad con HTTPS, cabeceras de respuesta restrictivas, comprobaciones de origen, tamaños de solicitud limitados y entrega protegida de recursos. |
| **Copias de seguridad y operación** | Archivos cifrables opcionalmente con age, tratamiento separado de claves, automatización privada del operador a través de un socket Unix y supervisión compatible con Prometheus. |

> [!NOTE]
> Towk no ofrece cifrado de extremo a extremo generalizado para los mensajes normales. El servidor en ejecución debe descifrar los campos protegidos para los clientes autorizados. Los archivos adjuntos, los avatares y una parte considerable de los metadatos permanecen fuera de la envoltura de cifrado a nivel de aplicación de Towk y requieren protección a nivel de infraestructura. Los medios de voz y vídeo pueden utilizar E2EE de LiveKit.

Consulta el modelo exacto antes de evaluar Towk para usos sensibles:

- [Política de seguridad](SECURITY.md)
- [Guía de seguridad y privacidad](apps/docs-website/src/content/docs/guides/operations/security.mdx)
- [Cifrado en reposo y eliminación de datos](apps/docs-website/src/content/docs/guides/operations/privacy-erasure.mdx)
- [Copia de seguridad y restauración](apps/docs-website/src/content/docs/guides/operations/backup-restore.mdx)

## Ejecútalo a tu manera

| Ruta | Uso recomendado | Composición |
|---|---|---|
| **Binario único** | Evaluación, equipos pequeños y máquinas virtuales sencillas | Cliente web, API y NATS integrados en un proceso compacto. |
| **Docker Compose** | La mayoría de servidores autoalojados | Towk con NATS explícito, Caddy y LiveKit opcional en un mismo host. |
| **Kubernetes / servicios externos** | Operadores con una plataforma existente | NATS externo, almacenamiento compatible con S3, LiveKit y varias réplicas Towk cuando la infraestructura circundante está cualificada. |

Towk no necesita MySQL ni PostgreSQL. El estado persistente de la aplicación se basa en NATS JetStream y proyecciones, mientras que el cliente web se compila dentro de la distribución del servidor Go.

## Pruébalo en local

Towk utiliza [mise](https://mise.jdx.dev/) para proporcionar su cadena de herramientas de desarrollo fijada.

```sh
git clone https://github.com/Yo-DDV/Towk.git
cd Towk
mise trust
mise run setup
mise dev
```

Abre <http://localhost:4000>.

Esta ruta de desarrollo utiliza datos de arranque locales. No reutilices credenciales ni valores predeterminados de desarrollo en un despliegue público.

Para un despliegue duradero, empieza por:

- [Introducción](apps/docs-website/src/content/docs/getting-started/introduction.mdx)
- [Inicio rápido](apps/docs-website/src/content/docs/getting-started/quick-start.mdx)
- [Antes de desplegar](apps/docs-website/src/content/docs/guides/deployment/read-this-first.mdx)
- [Arquitectura](docs/ARCHITECTURE.md)

## Estado del proyecto y expectativas

Towk se mantiene como un proyecto independiente, público y pre-1.0.

- Las API públicas y los contratos de despliegue todavía pueden evolucionar durante la serie `0.x`.
- Los despliegues importantes deben usar versiones inmutables y procedimientos de restauración probados.
- La PWA es el cliente actual para escritorio y móvil; por ahora no se publican paquetes en tiendas de aplicaciones.
- Towk no ofrece actualmente una edición alojada ni un plan de soporte comercial.
- Los errores, las propuestas de funciones acotadas y las preguntas de autoalojamiento se gestionan mediante [GitHub Issues](https://github.com/Yo-DDV/Towk/issues/new/choose).
- Las vulnerabilidades deben comunicarse de forma privada siguiendo [SECURITY.md](SECURITY.md).

La hoja de ruta se basa en pruebas: el trabajo completado debe existir en el repositorio, mientras que el trabajo planificado sigue sujeto a diseño y validación. Consulta [ROADMAP.md](ROADMAP.md).

## Documentación y registros del proyecto

| Necesidad | Referencia |
|---|---|
| Introducción al producto y despliegue | [Fuentes de documentación](apps/docs-website/src/content/docs/) |
| Arquitectura y API | [Inventario de arquitectura](docs/ARCHITECTURE.md) · [ADR](docs/adr/INDEX.md) · [FDR](docs/fdr/INDEX.md) |
| Operación y seguridad | [Seguridad](SECURITY.md) · [Soporte](SUPPORT.md) · [Cualificación del rendimiento](docs/PERFORMANCE.md) |
| Proceso del proyecto | [Gobernanza](GOVERNANCE.md) · [Guía de participación](CONTRIBUTING.md) · [Hoja de ruta](ROADMAP.md) |
| Origen y compatibilidad | [Procedencia](PROVENANCE.md) · [Política upstream](UPSTREAM.md) · [Código fuente correspondiente](SOURCE.md) |

## Licencia y origen

Towk conserva el modelo de licencia por archivo del repositorio:

- el servidor, la CLI y la distribución empaquetada del servidor se publican generalmente bajo **AGPL-3.0-or-later**;
- las superficies identificadas explícitamente del frontend, las API públicas, la documentación y los ejemplos se publican bajo **Apache-2.0**;
- el límite exacto y legible por máquinas se define en [REUSE.toml](REUSE.toml), con avisos de terceros en [NOTICE](NOTICE).

Towk es un proyecto independiente basado en [Chatto](https://github.com/chattocorp/chatto). Conserva la autoría, los avisos y los contratos de compatibilidad de upstream mientras toma sus propias decisiones de producto, versiones y soporte. Towk no está respaldado, patrocinado, operado ni soportado por ChattoCorp GmbH.
