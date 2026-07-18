# InfluxDB output (K6 Stratos default)

k6 ships metrics to InfluxDB via CLI `--out`, not in-script.

## Stratos run defaults

```json
{
  "output_args": "--out influxdb=http://grafana-hub-influxdb.grafana-hub.svc.cluster.local:8086/k6s",
  "use_output": "true"
}
```

## Per TestRun (portal Add Test form)

Enable **Use arguments** and set:

```
--out influxdb=http://<influx-host>:8086/k6s
```

## InfluxDB v2

```
--out influxdb-v2=http://<host>:8086/k6s,org=<org>,bucket=<bucket>,token=<token>
```

Prefer mounting the token from a K8s secret via env expansion in the operator spec.

## Combine with any HTTP template

Use `templates/http/load.js` (or any HTTP script) with Influx output — no script changes required.

## Portal metrics page

After the run, open **Metrics** in K6 Stratos to query past runs from InfluxDB.
