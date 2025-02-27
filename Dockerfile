# Usamos Node.js como base
FROM node:18

# Creamos el directorio de la aplicación dentro del contenedor
WORKDIR /usr/src/app

# Copiamos los archivos package.json y package-lock.json
COPY package*.json ./

# Instalamos las dependencias
RUN npm install

# Copiamos el resto del código al contenedor
COPY . .

# Exponemos el puerto 8080 para que la API pueda recibir peticiones
EXPOSE 8080

# Ejecutamos la API al iniciar el contenedor
CMD ["node", "index.js"]
