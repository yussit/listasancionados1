# Sistema independiente de consulta de sanciones ASIPONA

## Propuesta tecnica

La mejor arquitectura para este caso es una aplicacion web independiente, desplegada en un dominio propio, con dos capas:

1. Frontend web responsivo para celular, tablet y computadora.
2. Backend privado de consulta que lee y sincroniza la base desde Google Sheets, CSV publicado o archivo local.

El sistema no se conecta a PIS Check Web. Los accesos ASIPONA solo abren una URL, inician sesion con usuario y contrasena, y buscan por nombre, numero de empleado o QR. Los operadores no pueden editar registros desde la plataforma.

## Tecnologias elegidas

- Node.js 20+: runtime estable y facil de desplegar.
- Express 5: servidor web y API ligera.
- Google Sheets API: lectura privada de una hoja controlada por una cuenta de servicio.
- CSV fallback: permite usar Excel web o Google Sheets publicado como CSV.
- HTML, CSS y JavaScript sin framework: carga rapida, menos mantenimiento y buen soporte en equipos moviles.
- Helmet, rate limit y cookies firmadas: seguridad base para produccion.

## Flujo de datos recomendado

### Opcion recomendada: Google Sheets privado

1. Crear una hoja con columnas:

```text
Nombre | Identificacion | Empresa | Motivo | FechaInicio | FechaTermino | Observaciones | Estatus
```

2. Crear una cuenta de servicio en Google Cloud.
3. Compartir el Google Sheet con el correo de la cuenta de servicio, solo como lector.
4. Configurar variables de entorno:

```env
GOOGLE_SHEETS_SPREADSHEET_ID=...
GOOGLE_SHEETS_RANGE=Sanciones!A:H
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
```

Ventaja: la hoja no tiene que ser publica y solo el backend puede leerla.

### Opcion simple: CSV publicado

Configurar:

```env
DATA_CSV_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=0
```

Ventaja: rapido de montar. Desventaja: si el enlace es publico, debe tratarse con mas cuidado.

### Opcion local

Editar `data/sanciones.csv`. Sirve para pruebas, respaldo o ambientes sin internet.

## Como ejecutar localmente

```bash
npm install
copy .env.example .env
npm run dev
```

Abrir:

```text
http://localhost:3000
```

Pantallas:

```text
/              Acceso autorizado
/consulta.html Consulta de sancionados
```

Usuarios demo:

```text
Administrador:
usuario: admin
contrasena: admin-demo

Operador:
usuario: operador.pajaritos
contrasena: operador-demo
```

## Como proteger la informacion

- Usar contrasenas hasheadas en `data/users.json`.
- Generar hash:

```bash
npm run hash-password -- "clave-larga-y-segura"
```

- Copiar el resultado en el campo `passwordHash` del usuario correspondiente:

```json
{
  "username": "operador.norte",
  "passwordHash": "scrypt:..."
}
```

- Configurar `SESSION_SECRET=valor-largo-aleatorio` en produccion.

- Servir siempre con HTTPS.
- No publicar el Google Sheet si contiene datos sensibles.
- Compartir el Sheet solo con responsables de actualizacion.
- No existe endpoint para crear, editar o borrar sanciones desde la app.
- La gestion de usuarios esta reservada al rol administrador.
- Revisar logs de acceso del hosting.
- Cambiar la clave cuando un acceso deje de estar autorizado.

## Como subirlo a un dominio

### Hosting sencillo

Opciones practicas:

- Render, Railway o Fly.io para correr Node/Express directamente.
- VPS con Nginx como proxy HTTPS.
- Vercel/Cloudflare Workers si se adapta el backend a serverless.

Pasos generales:

1. Subir este proyecto a un repositorio Git.
2. Crear el servicio web en el proveedor.
3. Configurar comando de instalacion: `npm install`.
4. Configurar comando de inicio: `npm start`.
5. Agregar variables de entorno.
6. Asociar el dominio o subdominio, por ejemplo `sanciones.asipona-dominio.gob.mx`.
7. Activar HTTPS automatico del proveedor.

## Uso en accesos

- Guardar el dominio como favorito o acceso directo en celulares/tablets.
- Usar usuarios individuales para cada operador o grupo de acceso.
- Buscar minimo 3 caracteres para reducir errores y consultas innecesarias.
- Buscar por nombre, numero de empleado o empresa.
- Para escaneres QR fisicos, colocar el cursor en el campo de busqueda y escanear; el lector enviara el texto como teclado.
- Para camara, usar `Escanear con camara`. Esta opcion requiere HTTPS en produccion y un navegador compatible con `BarcodeDetector`.
- Pulsar `Actualizar base` cuando se requiera forzar lectura de la hoja.
- El sistema refresca la fuente automaticamente segun `DATA_SYNC_INTERVAL_MS`; tambien usa cache segun `DATA_CACHE_TTL_MS` para proteger rendimiento.

## Sincronizacion automatica

El backend ejecuta una sincronizacion al iniciar y despues repite la lectura de la fuente cada `DATA_SYNC_INTERVAL_MS` milisegundos.

```env
DATA_SYNC_INTERVAL_MS=300000
DATA_CACHE_TTL_MS=300000
```

Con estos valores, los cambios hechos por el administrador en Google Sheets o Excel/CSV se reflejan normalmente en un maximo aproximado de 5 minutos, sin modificar codigo ni reiniciar la aplicacion.

Para varios accesos simultaneos, el sistema usa cache en memoria y un bloqueo de refresco: si muchos operadores consultan a la vez, no dispara varias lecturas iguales contra la hoja.

## Endpoints

- `GET /api/health`: estado del servicio.
- `POST /api/auth/login`: inicia sesion.
- `POST /api/auth/logout`: cierra sesion.
- `GET /api/session`: valida sesion.
- `GET /api/sanciones/search?q=texto`: busca sanciones.
- `POST /api/sanciones/refresh`: fuerza actualizacion de la fuente.
- `GET /api/admin/users`: lista usuarios, solo administrador.
- `POST /api/admin/users`: crea usuarios, solo administrador.
- `GET /api/admin/audit`: consulta bitacora, solo administrador.
- `GET /api/admin/stats`: estadisticas, solo administrador.

## Roles y bitacora

- Administrador: gestiona usuarios, consulta estadisticas y revisa historial de busquedas.
- Operador: solo consulta sanciones. No puede editar usuarios, configuracion ni registros de sancionados.

Cada inicio de sesion y cada busqueda se guarda en `data/audit-log.ndjson` con:

- Usuario.
- Rol.
- Fecha y hora.
- Acceso asignado.
- Persona o QR consultado.
- Total de coincidencias y coincidencias bloqueantes.

## Formato de fechas

Acepta:

- `YYYY-MM-DD`
- `DD/MM/YYYY`
- `DD-MM-YYYY`

El estatus se calcula como:

- `Vencido` si la columna estatus dice vencido o la fecha de termino ya paso.
- `Activo` si la columna estatus dice activo o la fecha esta vigente.
- `Suspendido` si la columna estatus dice suspendido.

`Activo` y `Suspendido` se consideran alertas bloqueantes para el acceso. `Vencido` se muestra como historial no bloqueante.

## QR de PIS

El sistema intenta identificar datos dentro del QR aunque el formato varie:

- Texto directo: `EMP-001`.
- URL con parametros: `https://pis/...?...empleado=EMP-001`.
- Texto con claves: `empleado=EMP-001|nombre=Juan Perez`.
- JSON simple: `{ "empleado": "EMP-001", "nombre": "Juan Perez" }`.

La busqueda compara esos valores contra nombre, numero de empleado y empresa de la base sincronizada.

## Mejoras futuras recomendadas

- Bitacora avanzada con filtros por fechas y exportacion.
- Segundo factor para administradores.
- Panel administrativo separado para auditoria.
- Exportacion de reportes anonimizados.
- Lista blanca de IPs si los accesos tienen red fija.
