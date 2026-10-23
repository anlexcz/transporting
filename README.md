# Transporting

První MVP sandboxové hry / editoru autobusové sítě nad OpenStreetMap.

## Co umí v1

- MapLibre mapa s OSM podkladem
- vytváření, přesun a mazání zastávek a waypointů
- linky se samostatným směrem A/B
- skládání trasy klikáním na existující body v mapě
- routing přes vyměnitelnou routing vrstvu (výchozí OSRM)
- délka a odhad jízdní doby včetně pobytů v zastávkách
- obratové časy
- šest provozních období, intervaly a okamžitý výpočet potřebných vozidel
- PostgreSQL + PostGIS persistence

## Spuštění

Požadavky: Node.js 20+, npm, Docker.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:init
npm run dev
```

Web: http://localhost:5173  
API: http://localhost:3001

> Výchozí veřejný OSRM server a `tile.openstreetmap.org` jsou vhodné pro lokální vývoj/MVP. Pro veřejný provoz nasaď vlastní routing/tile službu nebo poskytovatele s odpovídajícími limity.

## Ovládání

1. Klikni **+ Zastávka** a umísti nejméně dvě zastávky.
2. Vytvoř linku.
3. Vyber směr A a klikni **Přidávat body kliknutím v mapě**.
4. Klikni v pořadí na zastávky a případné waypointy.
5. Totéž udělej pro směr B.
6. Nastav obratové časy a intervaly; počet vozidel se přepočítává automaticky.

## Architektura

- `apps/web` — React + TypeScript + MapLibre GL JS
- `apps/api` — Node.js + TypeScript + Express
- `packages/shared` — sdílené typy a výpočty
- PostgreSQL/PostGIS — persistence
- `RoutingProvider` — rozhraní umožňující později vyměnit OSRM za Valhallu/GraphHopper

## Další kroky

Po stabilizaci v1: přestupní uzly, cestující/poptávka, vozidla, depa, ekonomika a fyzická simulace provozu.
