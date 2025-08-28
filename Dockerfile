# Use an official lightweight Node.js image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy the rest of the application source code
COPY . .

# Google Cloud Run expects the container to listen on the port defined by this env var.
# Default is 8080.
ENV PORT=8080

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run your app
# Make sure your server.js (or main entry file) is correct
CMD [ "node", "server.js" ]