# Plataforma FTTH en Windows

Se instala en un PC con **Windows 10/11** de la oficina (el "PC servidor") y se usa desde
ese PC y desde cualquier PC o celular conectado a la misma red (cable, Wi‑Fi o VPN).
No necesita Docker: queda como dos servicios de Windows que arrancan solos al encender
el PC, aunque nadie inicie sesión.

## Requisitos del PC servidor

- Windows 10 u 11 de 64 bits (Home o Pro).
- 4 GB de RAM como mínimo (8 GB recomendado) y 5 GB libres en disco.
- Internet durante la instalación (descarga unos 400 MB).
- IP fija: reserve la IP del PC en el router.

## Instalar (una sola vez)

1. Descomprima el sistema en **`C:\ftth`** (no en el Escritorio ni en Documentos: los
   servicios de Windows no pueden usar carpetas de usuario).
2. Doble clic en **`C:\ftth\INSTALAR.cmd`** y acepte el permiso de administrador.
3. Responda las preguntas (casi todas con Enter) y cree el primer administrador.

Tarda de 5 a 15 minutos según la conexión. Si se interrumpe, vuelva a ejecutar
`INSTALAR.cmd`: conserva los datos y las claves.

## Usar

Doble clic en **Plataforma FTTH** en el escritorio: abre `https://localhost`.

En el **menú Inicio → Plataforma FTTH**:

| Acceso | Para qué |
|---|---|
| Crear usuario | Usuario con contraseña y rol |
| Estado | Si todo funciona y la dirección para otros equipos |
| Respaldar | Base de datos, fotos y configuración en `C:\ftth\respaldos` (guarda 14) |
| Reiniciar | Reinicia la plataforma |
| Configurar correo | Servidor de correo para invitaciones (opcional) |
| Actualizar | Instala una versión nueva (respalda antes) |
| Borrar datos de demostración | Solo si los cargó al instalar |

## Usuarios sin correo

En **Usuarios → Invitar usuario** la plataforma crea un enlace para que la persona fije
su contraseña: cópielo o compártalo por WhatsApp con el botón. Si alguien olvida su
contraseña, el botón **Enlace de acceso** junto a su nombre genera uno nuevo. Los enlaces
sirven una sola vez y vencen (7 días la invitación, 3 días el de acceso).

Si configura un correo (menú Inicio → Configurar correo), los enlaces además llegan
por correo y funciona "¿Olvidó su contraseña?" en la pantalla de ingreso.

## Entrar desde otros PCs y celulares

Dirección: `https://IP-DEL-PC-SERVIDOR` (la muestra **Estado**).

Cada equipo instala una vez el certificado de la oficina desde
`http://IP-DEL-PC-SERVIDOR/certificado.crt`. Sin él, el navegador muestra una advertencia
y el GPS no funciona.

- **Android**: Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado →
  Certificado de CA → elegir el archivo descargado.
- **iPhone**: abrir el enlace en Safari → Ajustes → Perfil descargado → Instalar; luego
  Ajustes → General → Información → Ajustes de confianza de certificados → activar.
- **PCs con Windows**: doble clic en el archivo → Instalar certificado → Equipo local →
  "Entidades de certificación raíz de confianza".

En el celular, menú del navegador → **Agregar a pantalla de inicio** deja la aplicación
como un ícono más.

## Respaldos

Si aceptó el respaldo diario, corre solo a las 13:00. Copie `C:\ftth\respaldos` a otro
equipo o disco externo con frecuencia. Para recuperar uno:

```powershell
powershell -ExecutionPolicy Bypass -File C:\ftth\windows\ftth.ps1 restaurar C:\ftth\respaldos\ftth_base_AAAA-MM-DD_HHMM.dump
```

## Actualizar

Descomprima la versión nueva sobre `C:\ftth` (reemplazar archivos) y use **Actualizar**
en el menú Inicio. Los datos y la configuración se conservan.

## Avanzado

Todo lo hace `windows\ftth.ps1` (`powershell -ExecutionPolicy Bypass -File ftth.ps1 ayuda`).
Acciones extra: `logs`, `detener`, `iniciar`, `programar-respaldo 13:00`, `desinstalar`.

Qué queda en `C:\ftth`:

| Carpeta | Contenido |
|---|---|
| `runtime\` | PostgreSQL 17 + PostGIS, Node.js, PostgREST y el envoltorio de servicio |
| `datos\` | base de datos, fotos, certificados, configuración (`config.json`, `secretos.json`) y registros. Solo administradores. |
| `respaldos\` | respaldos. Solo administradores. |

Servicios de Windows: **PlataformaFTTH-BaseDatos** (PostgreSQL, puerto 54330 solo en este
PC) y **PlataformaFTTH** (servidor web, puertos 80 y 443).
