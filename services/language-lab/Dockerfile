FROM python:3.12-slim
USER root
ARG DEBIAN_MIRROR=https://mirrors.aliyun.com/debian
RUN sed -i "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
       gcc g++ gcc-mips-linux-gnu g++-mips-linux-gnu \
       gcc-riscv64-linux-gnu g++-riscv64-linux-gnu \
       octave gnuplot-nox fonts-freefont-otf iverilog \
    && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends ghostscript \
    && rm -rf /var/lib/apt/lists/*
COPY worker.py trace_runner.py /opt/lab/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["timeout", "--signal=KILL", "180", "python3", "-u", "/opt/lab/worker.py"]
COPY controller.py /opt/lab/controller.py
