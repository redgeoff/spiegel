FROM node

MAINTAINER Geoff Cox redgeoff@gmail.com

WORKDIR /usr/src/app

# --unsafe is required for leveldown to install properly
RUN npm install -g spiegel --unsafe

COPY docker-entrypoint.sh .

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["/usr/local/bin/spiegel"]
