FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libstdc++6 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN ln -s /data /app/data

VOLUME ["/data"]

EXPOSE 8000

CMD ["gunicorn", "--workers", "4", "--threads", "2", "--preload", \
     "--timeout", "120", "--worker-tmp-dir", "/dev/shm", \
     "-b", "0.0.0.0:8000", "app:app"]
