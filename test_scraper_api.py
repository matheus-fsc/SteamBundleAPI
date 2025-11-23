#!/usr/bin/env python3
import asyncio
import aiohttp
import json

async def test():
    bundle_id = 1000
    url = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/'
    
    ids_list = [{"bundleid": bundle_id}]
    context = {"language": "brazilian", "country_code": "BR"}
    input_json = json.dumps({"ids": ids_list, "context": context})
    
    params = {
        'key': '516C1E2D6FA9FECFB0DE14393F3FDCF0',
        'input_json': input_json
    }
    
    print(f'🔍 Testando Bundle {bundle_id}...\n')
    
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            print(f'Status: {resp.status}')
            data = await resp.json()
            
            print('\n' + '=' * 60)
            print('RESPOSTA COMPLETA DA API:')
            print('=' * 60)
            print(json.dumps(data, indent=2))
            
            if 'response' not in data or 'store_items' not in data['response']:
                print('\n❌ Resposta não tem store_items!')
                return
                
            bundle = data['response']['store_items'][0]
            
            print('=' * 60)
            print('ASSETS (imagens):')
            print('=' * 60)
            print(json.dumps(bundle.get('assets', {}), indent=2))
            
            print('\n' + '=' * 60)
            print('IMAGE_URL extraído:')
            print('=' * 60)
            image_url = bundle.get('assets', {}).get('header', '')
            print(f"'{image_url}'")
            print(f"Vazio: {image_url == ''}")
            
            print('\n' + '=' * 60)
            print('CONTENT DESCRIPTORS (NSFW):')
            print('=' * 60)
            descriptors = bundle.get('content_descriptorids', [])
            print(f"IDs: {descriptors}")
            print(f"Is NSFW (3 in list): {3 in descriptors}")
            
            print('\n' + '=' * 60)
            print('INCLUDED_ITEMS (games):')
            print('=' * 60)
            items = bundle.get('included_items', [])
            print(f"Total: {len(items)}")
            if items:
                print('\nPrimeiro item:')
                print(json.dumps(items[0], indent=2))
                
                games = [{'app_id': item['id']} for item in items if item.get('item_type') == 0]
                print(f'\nGames filtrados (item_type==0): {len(games)}')

asyncio.run(test())
