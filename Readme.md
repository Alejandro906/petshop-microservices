# Aplicación de Tienda de Mascotas - Microservicios

Esta aplicación es una plataforma de comercio electrónico para productos de mascotas, construida con una arquitectura de microservicios. La aplicación utiliza Node.js y MongoDB, implementando siete servicios independientes:

- **Servicio de Usuarios**: Gestiona autenticación y datos de usuarios
- **Servicio de Productos**: Catálogo y gestión de inventario
- **Servicio de Carrito**: Manejo del carrito de compras
- **Servicio de Categorías**: Organización de productos
- **Servicio de Órdenes**: Procesamiento de pedidos
- **Servicio de Búsqueda**: Búsqueda en productos y categorías
- **API Gateway**: Punto de entrada unificado

La aplicación implementa comunicación asíncrona mediante RabbitMQ para eventos entre servicios, y utiliza Kubernetes con Nginx para balanceo de carga y alta disponibilidad. Cada servicio mantiene su propia base de datos MongoDB, asegurando independencia y escalabilidad.

La arquitectura permite una alta disponibilidad y resiliencia, con múltiples instancias de cada servicio gestionadas por Kubernetes, facilitando el mantenimiento y la escalabilidad del sistema.

# Instalación de la Aplicación

1. **Pre-requisitos**
   - Docker Desktop con Kubernetes habilitado
   - Node.js y npm instalados
   - Git instalado
   - MongoDB instalado
   - Kompose instalado

2. **Pasos de Instalación**

```bash
# Iniciar Docker Desktop y habilitar Kubernetes

# Clonar el repositorio
git clone [nombre del proyecto]
cd [nombre del proyecto]

# Construir servicios
docker-compose build

# Desplegar en Kubernetes
cd kubernetes
kubectl apply -f k8s-config.yaml

# Verificar el estado de los pods
kubectl get pods -n petshop

# Si necesita reiniciar un pod específico
kubectl delete pod [id del servicio] -n petshop