FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download || true

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o sfu-server main.go

FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/sfu-server .

EXPOSE 8443
EXPOSE 50000-50100/udp

CMD ["./sfu-server"]
