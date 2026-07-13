# Changelog

All notable changes to Towk. Subsequent entries are maintained from conventional
commits on `main`; this first standalone release entry is curated to separate
Towk work from the inherited Chatto history.

## [0.6.0](https://github.com/Yo-DDV/Towk/compare/v0.5.0...v0.6.0) (2026-07-13)


### ⚠ BREAKING CHANGES

* **api:** consolidate ConnectRPC surface ([#1306](https://github.com/Yo-DDV/Towk/issues/1306))
* **api:** clean up server assets calls and includes ([#1303](https://github.com/Yo-DDV/Towk/issues/1303))
* **api:** consolidate shared api shapes ([#1302](https://github.com/Yo-DDV/Towk/issues/1302))
* **api:** consolidate shared public API types ([#1299](https://github.com/Yo-DDV/Towk/issues/1299))
* **api:** consolidate public ConnectRPC API ([#1295](https://github.com/Yo-DDV/Towk/issues/1295))
* **api:** polish ConnectRPC API for 0.4.0 ([#1224](https://github.com/Yo-DDV/Towk/issues/1224))
* **operator:** add socket-backed operator user administration ([#1164](https://github.com/Yo-DDV/Towk/issues/1164))
* **api:** reshape server profile responses ([#1185](https://github.com/Yo-DDV/Towk/issues/1185))
* **api:** split ConnectRPC packages ([#1179](https://github.com/Yo-DDV/Towk/issues/1179))
* **api:** replace GraphQL with ConnectRPC ([#1166](https://github.com/Yo-DDV/Towk/issues/1166))
* **api:** use optional timeline presence fields ([#1110](https://github.com/Yo-DDV/Towk/issues/1110))
* **sidebar:** list rooms visible via room.list ([#961](https://github.com/Yo-DDV/Towk/issues/961))
* **cli:** remove reset command ([#926](https://github.com/Yo-DDV/Towk/issues/926))
* **docker:** use config and data root paths ([#903](https://github.com/Yo-DDV/Towk/issues/903))
* refresh current room on reconnect ([#878](https://github.com/Yo-DDV/Towk/issues/878))
* **auth:** stabilize cookie session auth ([#883](https://github.com/Yo-DDV/Towk/issues/883))

### Features

* add LiveKit screen sharing ([#1021](https://github.com/Yo-DDV/Towk/issues/1021)) ([990dd59](https://github.com/Yo-DDV/Towk/commit/990dd598aa2be7fcbc1a367d70f4a9fca3625c3c))
* add notification badge counts ([#909](https://github.com/Yo-DDV/Towk/issues/909)) ([eb7178b](https://github.com/Yo-DDV/Towk/commit/eb7178b524cbd002f243ce2fdafe8268217c62c7))
* add notification sound shaping controls ([#962](https://github.com/Yo-DDV/Towk/issues/962)) ([68a6aea](https://github.com/Yo-DDV/Towk/commit/68a6aea90bcd0043a74bbbbe5294255b748a9368))
* add room files sidebar ([#920](https://github.com/Yo-DDV/Towk/issues/920)) ([d4e8cad](https://github.com/Yo-DDV/Towk/commit/d4e8cad43138b22e71b5881e6bf74637dc90ea00))
* add scoped server sign-out ([#1006](https://github.com/Yo-DDV/Towk/issues/1006)) ([1815b69](https://github.com/Yo-DDV/Towk/commit/1815b69f9bfe4c50859336276ee0df57d021603c))
* add simple and rich composer modes ([#974](https://github.com/Yo-DDV/Towk/issues/974)) ([ac038d4](https://github.com/Yo-DDV/Towk/commit/ac038d48904f4a8256b8db9b638798a4337e7aa1))
* add universal rooms ([#1046](https://github.com/Yo-DDV/Towk/issues/1046)) ([ed8be53](https://github.com/Yo-DDV/Towk/commit/ed8be535d2bfc266543480b12afffc15f2e51232))
* **admin:** filter event log ([#1056](https://github.com/Yo-DDV/Towk/issues/1056)) ([3f20dfc](https://github.com/Yo-DDV/Towk/commit/3f20dfcc10eac07fa033de05d51d1fe1324a8b43))
* **api:** add ConnectRPC asset uploads ([#1249](https://github.com/Yo-DDV/Towk/issues/1249)) ([50f8125](https://github.com/Yo-DDV/Towk/commit/50f81255ad60f2d51795139adaf36b25061477ac))
* **api:** add ConnectRPC DM start ([#1157](https://github.com/Yo-DDV/Towk/issues/1157)) ([19af955](https://github.com/Yo-DDV/Towk/commit/19af955c9f3caa9519e39b95d3026e0cd311755f))
* **api:** add ConnectRPC public API PoC ([#1067](https://github.com/Yo-DDV/Towk/issues/1067)) ([514f3eb](https://github.com/Yo-DDV/Towk/commit/514f3eb44c3d3f613fd8e562aca0107109441cb8))
* **api:** add ConnectRPC reflection ([#1182](https://github.com/Yo-DDV/Towk/issues/1182)) ([77eafbf](https://github.com/Yo-DDV/Towk/commit/77eafbf874917d3e7e6815f026d58c898bfd669c))
* **api:** add ConnectRPC room timeline PoC ([#1074](https://github.com/Yo-DDV/Towk/issues/1074)) ([18c3a18](https://github.com/Yo-DDV/Towk/commit/18c3a183e192a5d061130ad5a90e2467a6b89a2f))
* **api:** add protobuf realtime websocket ([#1158](https://github.com/Yo-DDV/Towk/issues/1158)) ([4b06c63](https://github.com/Yo-DDV/Towk/commit/4b06c63f35f69ded1ed4af89c62f1e3674e23d01))
* **api:** add resource batch reads ([#1232](https://github.com/Yo-DDV/Towk/issues/1232)) ([e3e5c43](https://github.com/Yo-DDV/Towk/commit/e3e5c43601953ddabb28a00551c7e571aaf92372))
* **api:** clean up ConnectRPC surface ([#1171](https://github.com/Yo-DDV/Towk/issues/1171)) ([23f29b5](https://github.com/Yo-DDV/Towk/commit/23f29b5954bfec4295946d88f8e2a50080125ed1))
* **api:** clean up ConnectRPC surface ([#1178](https://github.com/Yo-DDV/Towk/issues/1178)) ([faf487b](https://github.com/Yo-DDV/Towk/commit/faf487bacb55496dede08fa0a25510a82560c83f))
* **api:** clean up server assets calls and includes ([#1303](https://github.com/Yo-DDV/Towk/issues/1303)) ([e4400eb](https://github.com/Yo-DDV/Towk/commit/e4400ebb201ebac88bc45ff1c1625b548700a922))
* **api:** consolidate membership services ([#1293](https://github.com/Yo-DDV/Towk/issues/1293)) ([95e433d](https://github.com/Yo-DDV/Towk/commit/95e433d149f5b04f1f2b71a8c64441f0b44a7e99))
* **api:** consolidate shared api shapes ([#1302](https://github.com/Yo-DDV/Towk/issues/1302)) ([a53eb66](https://github.com/Yo-DDV/Towk/commit/a53eb66a3b66015399cc59cfbed61b10d6be273e))
* **api:** consolidate shared public API types ([#1299](https://github.com/Yo-DDV/Towk/issues/1299)) ([46b9af8](https://github.com/Yo-DDV/Towk/commit/46b9af8a42bdd9021970486af7a7a5375c28c6ed))
* **api:** extract generated TypeScript clients ([#1183](https://github.com/Yo-DDV/Towk/issues/1183)) ([66a049e](https://github.com/Yo-DDV/Towk/commit/66a049e6fce6ef5aced4eca8cd6825f12eaafc60))
* **api:** extract TypeScript API client ([#1184](https://github.com/Yo-DDV/Towk/issues/1184)) ([5b37f47](https://github.com/Yo-DDV/Towk/commit/5b37f47696123e5ddf26bc3ea74081f44cc6c696))
* **api:** migrate reactions to ConnectRPC ([#1128](https://github.com/Yo-DDV/Towk/issues/1128)) ([3d2975e](https://github.com/Yo-DDV/Towk/commit/3d2975ec0f092f336bbce0e1f244e97974129b35))
* **api:** polish ConnectRPC API for 0.4.0 ([#1224](https://github.com/Yo-DDV/Towk/issues/1224)) ([29eab4f](https://github.com/Yo-DDV/Towk/commit/29eab4f851e4888353daed534e34a799a1f8e27c))
* **api:** port message posting to ConnectRPC ([#1093](https://github.com/Yo-DDV/Towk/issues/1093)) ([1f99c23](https://github.com/Yo-DDV/Towk/commit/1f99c23968007b40c4d48a43318972eeedd478f2))
* **api:** port read state and thread follow to ConnectRPC ([#1087](https://github.com/Yo-DDV/Towk/issues/1087)) ([10dc8ef](https://github.com/Yo-DDV/Towk/commit/10dc8efc90d09d34124af574d5dfe4863225cbe5))
* **api:** replace GraphQL with ConnectRPC ([#1166](https://github.com/Yo-DDV/Towk/issues/1166)) ([558b166](https://github.com/Yo-DDV/Towk/commit/558b1662636de264a1edea550b37ae98de57f7a0))
* **api:** reshape server profile responses ([#1185](https://github.com/Yo-DDV/Towk/issues/1185)) ([5e28aae](https://github.com/Yo-DDV/Towk/commit/5e28aaeae059ee6b01229b1185b72edd6fbe8f20))
* **api:** split ConnectRPC packages ([#1179](https://github.com/Yo-DDV/Towk/issues/1179)) ([a1234e9](https://github.com/Yo-DDV/Towk/commit/a1234e929bfa85545ffe0d5b90cd1708bab8eda8))
* **api:** use optional timeline presence fields ([#1110](https://github.com/Yo-DDV/Towk/issues/1110)) ([4f93ee0](https://github.com/Yo-DDV/Towk/commit/4f93ee00d050437585163e1c093108f8f07002bc))
* **auth:** add SSO account creation and linking ([#1167](https://github.com/Yo-DDV/Towk/issues/1167)) ([8917e3a](https://github.com/Yo-DDV/Towk/commit/8917e3abf2dd0a43139cd332ed84a99403f353b2))
* **auth:** configure email OTP throttling ([#902](https://github.com/Yo-DDV/Towk/issues/902)) ([f1414bc](https://github.com/Yo-DDV/Towk/commit/f1414bceb4f7f012481112814d45f842b9136944))
* **auth:** type runtime credentials ([#1195](https://github.com/Yo-DDV/Towk/issues/1195)) ([4365744](https://github.com/Yo-DDV/Towk/commit/43657443aa783f551b1f332939764c5e6bd89e8e))
* **auth:** use bearer tokens for origin GraphQL ([#897](https://github.com/Yo-DDV/Towk/issues/897)) ([a2bde1e](https://github.com/Yo-DDV/Towk/commit/a2bde1e48f485acb725d55e2d57ef44717717069))
* **brand:** adopt exact v2 identity assets ([#7](https://github.com/Yo-DDV/Towk/issues/7)) ([e388e21](https://github.com/Yo-DDV/Towk/commit/e388e21b2262d4c31e1739b08c0ca425c5d6fa33))
* **branding:** apply Towk product identity ([c1868b5](https://github.com/Yo-DDV/Towk/commit/c1868b5e4e599523beb75d7330c91952dbc10cd4))
* **brand:** introduce premium Towk identity ([ed92822](https://github.com/Yo-DDV/Towk/commit/ed92822f07423d795f2ef6bd537a0bb3401d772c))
* **brand:** introduce premium Towk identity ([f1ebc8a](https://github.com/Yo-DDV/Towk/commit/f1ebc8af90177817637f4105388d9edb07040d4f))
* **cli:** remove reset command ([#926](https://github.com/Yo-DDV/Towk/issues/926)) ([944c14a](https://github.com/Yo-DDV/Towk/commit/944c14a19eea26a4116b47c889e77421ed1952ee))
* **cli:** remove reset command ([#928](https://github.com/Yo-DDV/Towk/issues/928)) ([249c271](https://github.com/Yo-DDV/Towk/commit/249c271c5c2719cec049ff097bad1121b46241ba))
* **composer:** submit with Ctrl/Cmd+Enter ([#960](https://github.com/Yo-DDV/Towk/issues/960)) ([704b1e9](https://github.com/Yo-DDV/Towk/commit/704b1e96a54d8c390d37fc716f6fb9199bd67fc5))
* **config:** configure SMTP TLS verification ([#1159](https://github.com/Yo-DDV/Towk/issues/1159)) ([68eda21](https://github.com/Yo-DDV/Towk/commit/68eda211ab1b3a39358a5e72ce2c22f0c1b4989b))
* **connectrpc:** add message management API ([#1146](https://github.com/Yo-DDV/Towk/issues/1146)) ([c76b859](https://github.com/Yo-DDV/Towk/commit/c76b859b7e4a7e3a2d4116439312ff65b674c314))
* **connectrpc:** add room directory service ([#1138](https://github.com/Yo-DDV/Towk/issues/1138)) ([f530f38](https://github.com/Yo-DDV/Towk/commit/f530f38b97c1833114ab957f98067f5b6b855478))
* **connectrpc:** add room lifecycle service ([#1134](https://github.com/Yo-DDV/Towk/issues/1134)) ([2e4134b](https://github.com/Yo-DDV/Towk/commit/2e4134b1849c1755a568815c083d29d6409d2e25))
* **connectrpc:** port thread history reads ([#1083](https://github.com/Yo-DDV/Towk/issues/1083)) ([0da16a3](https://github.com/Yo-DDV/Towk/commit/0da16a33b66dfa2f6cc7bd29d24911ed9459f2d2))
* **core:** persist link preview assets via storage backend ([#1060](https://github.com/Yo-DDV/Towk/issues/1060)) ([ccc026d](https://github.com/Yo-DDV/Towk/commit/ccc026dfa6f8847d2c8fa11a3ff57adf9e796e28))
* **core:** store thread follows in EVT ([#1233](https://github.com/Yo-DDV/Towk/issues/1233)) ([f250045](https://github.com/Yo-DDV/Towk/commit/f2500451a86fe8958108924a67922d4aebf3a9cb))
* **dev:** add Mailpit to mise dev ([#1238](https://github.com/Yo-DDV/Towk/issues/1238)) ([a478d7c](https://github.com/Yo-DDV/Towk/commit/a478d7cd2a3e95e697169f1155c4ca65c503f007))
* **docs:** add release notes pages ([#1180](https://github.com/Yo-DDV/Towk/issues/1180)) ([6dee88b](https://github.com/Yo-DDV/Towk/commit/6dee88be972406fde1113786057925641bda6d25))
* establish Towk product identity and governance ([02ff6bd](https://github.com/Yo-DDV/Towk/commit/02ff6bdd28e49cd41775ebed636d392357749143))
* **exporter:** add deployment-wide prometheus exporter ([#1059](https://github.com/Yo-DDV/Towk/issues/1059)) ([58780f9](https://github.com/Yo-DDV/Towk/commit/58780f986a9a8eda1aa2e1007a2ab0e18732269e))
* **frontend:** add call join leave sound cues ([#1023](https://github.com/Yo-DDV/Towk/issues/1023)) ([50f543c](https://github.com/Yo-DDV/Towk/commit/50f543c28f1a33fab29b277db5e82142e3e65931))
* **frontend:** add display theme preference ([#1018](https://github.com/Yo-DDV/Towk/issues/1018)) ([4209cce](https://github.com/Yo-DDV/Towk/commit/4209cce347937f13cb9ae4134837449dae5d096d))
* **frontend:** add French localization ([#32](https://github.com/Yo-DDV/Towk/issues/32)) ([88d38a6](https://github.com/Yo-DDV/Towk/commit/88d38a691760be85888d63463cb0a0deb8486501))
* **frontend:** add multi-image attachment gallery ([#1241](https://github.com/Yo-DDV/Towk/issues/1241)) ([3cf4a11](https://github.com/Yo-DDV/Towk/commit/3cf4a11ce723896dcae2a538d875d55e26ae4b54))
* **frontend:** add Paraglide-based client-shell i18n ([#1077](https://github.com/Yo-DDV/Towk/issues/1077)) ([7a031fa](https://github.com/Yo-DDV/Towk/commit/7a031fad3ef27b44da92a5d24ea49051684b9005))
* **frontend:** add Spanish and Portuguese locales ([e1aced7](https://github.com/Yo-DDV/Towk/commit/e1aced7a869828802e5b75e3abc9e39440d35921))
* **frontend:** add Trusted Types markdown policy ([#1307](https://github.com/Yo-DDV/Towk/issues/1307)) ([617c98c](https://github.com/Yo-DDV/Towk/commit/617c98cd047eb4f61dfea1bce95dbaa3c087c7d9))
* **frontend:** consolidate frontend design system ([#1053](https://github.com/Yo-DDV/Towk/issues/1053)) ([fcceddc](https://github.com/Yo-DDV/Towk/commit/fcceddc638374c44c6cb588e346740d2b185f396))
* **frontend:** improve admin member details ([#1057](https://github.com/Yo-DDV/Towk/issues/1057)) ([695b950](https://github.com/Yo-DDV/Towk/commit/695b950e77c7bda459315393282abc47b0c3e921))
* **frontend:** maximize call pane ([#1240](https://github.com/Yo-DDV/Towk/issues/1240)) ([a9d50b5](https://github.com/Yo-DDV/Towk/commit/a9d50b5209de01399642f94cd0786930e6c2db2b))
* **frontend:** move UI strings into i18n catalogs ([#1084](https://github.com/Yo-DDV/Towk/issues/1084)) ([8e12064](https://github.com/Yo-DDV/Towk/commit/8e1206483e681cac3918daf73d32a68a7d9189a9))
* **frontend:** preview Markdown in composer ([#876](https://github.com/Yo-DDV/Towk/issues/876)) ([d907805](https://github.com/Yo-DDV/Towk/commit/d907805b8164c532a55c1b305d1bda32caa547dd))
* **frontend:** refresh admin system dashboard ([#1160](https://github.com/Yo-DDV/Towk/issues/1160)) ([85fe15b](https://github.com/Yo-DDV/Towk/commit/85fe15b1236e3059c6f62b2500c55aff087ab788))
* **frontend:** refresh call sidebar UI ([#1001](https://github.com/Yo-DDV/Towk/issues/1001)) ([8abe541](https://github.com/Yo-DDV/Towk/commit/8abe5417c2d1014664b9b75d699a19f113037477))
* **frontend:** refresh toast styling ([#1260](https://github.com/Yo-DDV/Towk/issues/1260)) ([9103f9e](https://github.com/Yo-DDV/Towk/commit/9103f9e79a58b13a5f5b8fdfe6e7f35440978ad6))
* **frontend:** send typing indicators with ConnectRPC ([#1155](https://github.com/Yo-DDV/Towk/issues/1155)) ([96baf9e](https://github.com/Yo-DDV/Towk/commit/96baf9e61026ad87f0dc7ec76259ebd587cb63db))
* **frontend:** show call participants in room sidebar ([#1036](https://github.com/Yo-DDV/Towk/issues/1036)) ([c4521d1](https://github.com/Yo-DDV/Towk/commit/c4521d11e6fa764fe00585de32152d16834c0cc1))
* **frontend:** show reaction names in popups ([#1044](https://github.com/Yo-DDV/Towk/issues/1044)) ([c51ff19](https://github.com/Yo-DDV/Towk/commit/c51ff1986e003ba35d99ed84f319b9f0c093a172))
* **frontend:** show room descriptions in header ([#1037](https://github.com/Yo-DDV/Towk/issues/1037)) ([5aa8898](https://github.com/Yo-DDV/Towk/commit/5aa889824a015184dedc9892c9524e141f0d8e83))
* **frontend:** use ConnectRPC for message writes ([#1153](https://github.com/Yo-DDV/Towk/issues/1153)) ([a05105b](https://github.com/Yo-DDV/Towk/commit/a05105b51457d75c5e601234cf01a0abeb7470a1))
* **frontend:** use ConnectRPC for room commands ([#1150](https://github.com/Yo-DDV/Towk/issues/1150)) ([54a8a97](https://github.com/Yo-DDV/Towk/commit/54a8a970af687e6554334b696f0c5778c8c8b99c))
* gate message attachments with message.attach ([#966](https://github.com/Yo-DDV/Towk/issues/966)) ([a2757b2](https://github.com/Yo-DDV/Towk/commit/a2757b20500e905ead4cf5d7721a3c19577d9ee1))
* **governance:** establish issue-only public intake ([#8](https://github.com/Yo-DDV/Towk/issues/8)) ([bf86175](https://github.com/Yo-DDV/Towk/commit/bf86175a14b0a984c1d0244531f2fd07464266c7))
* group room files by date ([#937](https://github.com/Yo-DDV/Towk/issues/937)) ([7c8bf44](https://github.com/Yo-DDV/Towk/commit/7c8bf44e572c54396de90aa201132f4e6b8e420c))
* improve linked message previews ([#970](https://github.com/Yo-DDV/Towk/issues/970)) ([4959f92](https://github.com/Yo-DDV/Towk/commit/4959f9219905256ed842ba3b9b6a76102686318f))
* improve room member loading and search ([#963](https://github.com/Yo-DDV/Towk/issues/963)) ([ced435e](https://github.com/Yo-DDV/Towk/commit/ced435e5410532e55ebbbd0a57ab004caf4dedaf))
* **messages:** add copy link menu action ([#969](https://github.com/Yo-DDV/Towk/issues/969)) ([214c2a3](https://github.com/Yo-DDV/Towk/commit/214c2a3cd2b230e5e42ac3501148e0971e03db37))
* monitor projection startup duration ([#1004](https://github.com/Yo-DDV/Towk/issues/1004)) ([50b4ee9](https://github.com/Yo-DDV/Towk/commit/50b4ee98aca0b61a7e4bfbaaba3a2f1a0cb72eb6))
* **operator:** add socket-backed operator user administration ([#1164](https://github.com/Yo-DDV/Towk/issues/1164)) ([ed54cef](https://github.com/Yo-DDV/Towk/commit/ed54cef8cc99043d4809c17d1f7a4724dd4b7415))
* **ops:** establish Towk pilot baseline ([3582c62](https://github.com/Yo-DDV/Towk/commit/3582c620638a13f6118e6279c880d24d1c65e47c))
* **ops:** establish Towk pilot baseline ([e01bfa4](https://github.com/Yo-DDV/Towk/commit/e01bfa445c4a9942202bbe6a9c90a6ae2f8af427))
* **presence:** add user-controlled presence modes ([#1095](https://github.com/Yo-DDV/Towk/issues/1095)) ([84a6a2f](https://github.com/Yo-DDV/Towk/commit/84a6a2fd71b74fd92e2c96599c062e45fdf3c978))
* **profile:** add custom user statuses ([#1081](https://github.com/Yo-DDV/Towk/issues/1081)) ([fc63e6e](https://github.com/Yo-DDV/Towk/commit/fc63e6ea7d90edec55dcbd2f09e7c503b8d54eb9))
* quote selected text when replying ([#978](https://github.com/Yo-DDV/Towk/issues/978)) ([35251ea](https://github.com/Yo-DDV/Towk/commit/35251eaea5c042626d1e205cb27076ac1827bca0))
* show room sidebar in DMs ([#912](https://github.com/Yo-DDV/Towk/issues/912)) ([4d9626e](https://github.com/Yo-DDV/Towk/commit/4d9626e380fac58644871c0ba13a1ccb93cf3eac))
* **sidebar:** add group sidebar links ([#915](https://github.com/Yo-DDV/Towk/issues/915)) ([364eedc](https://github.com/Yo-DDV/Towk/commit/364eedc402ae4070cb9b1fffa1a4b486caea9584))
* **sidebar:** list rooms visible via room.list ([#961](https://github.com/Yo-DDV/Towk/issues/961)) ([b53aa80](https://github.com/Yo-DDV/Towk/commit/b53aa805bb378c54a1713ef6ecfd84a4d274dd74))
* simplify web push opt-in ([#971](https://github.com/Yo-DDV/Towk/issues/971)) ([5164df6](https://github.com/Yo-DDV/Towk/commit/5164df62b47086489e70af24ff49241048a4f59d))


### Bug Fixes

* **api:** address 0.4.0 surface review findings ([#1228](https://github.com/Yo-DDV/Towk/issues/1228)) ([75a4103](https://github.com/Yo-DDV/Towk/commit/75a4103e44a48aeee85f95ceb0d11c5b09cfdf32))
* **api:** align ConnectRPC permission exposure ([#1246](https://github.com/Yo-DDV/Towk/issues/1246)) ([bebfe6e](https://github.com/Yo-DDV/Towk/commit/bebfe6e17ad87eef05c1beffea7cda85b8349cb4))
* **api:** centralize Connect room RBAC in core ([#1149](https://github.com/Yo-DDV/Towk/issues/1149)) ([8d14e99](https://github.com/Yo-DDV/Towk/commit/8d14e995324ed987348651673562e1cfe55947a5))
* **api:** close ConnectRPC RBAC gaps ([#1207](https://github.com/Yo-DDV/Towk/issues/1207)) ([e66e23e](https://github.com/Yo-DDV/Towk/commit/e66e23e6c61ef9276bbc8a4016663e28805d38ba))
* **api:** include user status in generated docs ([#1092](https://github.com/Yo-DDV/Towk/issues/1092)) ([c23fcf2](https://github.com/Yo-DDV/Towk/commit/c23fcf23891b27d4e7ca447fe1c105feb6ee7e49))
* **api:** log internal connect errors ([#1329](https://github.com/Yo-DDV/Towk/issues/1329)) ([210468a](https://github.com/Yo-DDV/Towk/commit/210468a17122eab6189d5e7e083b9953376df386))
* **api:** make ConnectRPC plumbing idiomatic ([#1123](https://github.com/Yo-DDV/Towk/issues/1123)) ([356c58c](https://github.com/Yo-DDV/Towk/commit/356c58c05e28b7f1c0c489a9e3f9e7013bfc4331))
* **api:** preserve offline presence in snapshots ([#1172](https://github.com/Yo-DDV/Towk/issues/1172)) ([c993ea9](https://github.com/Yo-DDV/Towk/commit/c993ea92253a2d75283f41dfc482a5db1a8b51e5))
* **api:** skip invalid followed-thread rooms ([#1366](https://github.com/Yo-DDV/Towk/issues/1366)) ([91662f2](https://github.com/Yo-DDV/Towk/commit/91662f2d5b6c7aee4f2b0960a0143bea0c2e27e5))
* **api:** tighten ConnectRPC caller auth ([#1126](https://github.com/Yo-DDV/Towk/issues/1126)) ([f571273](https://github.com/Yo-DDV/Towk/commit/f57127345bb1eb77005c848f85ce3d864139191e))
* **api:** tolerate invalid presence user ids ([#1336](https://github.com/Yo-DDV/Towk/issues/1336)) ([7ab06c6](https://github.com/Yo-DDV/Towk/commit/7ab06c6407432204b634499e97563ea82e0e2bdd))
* **api:** tune room member page defaults ([#1354](https://github.com/Yo-DDV/Towk/issues/1354)) ([0288ca8](https://github.com/Yo-DDV/Towk/commit/0288ca89a07583cfc46544fd7d0968d8fee75d21))
* **api:** validate custom status emoji ([#1408](https://github.com/Yo-DDV/Towk/issues/1408)) ([3e599d0](https://github.com/Yo-DDV/Towk/commit/3e599d0d4c315312471b381323dde84b5ec04cbc))
* **assets:** prevent protected attachment caching ([#1261](https://github.com/Yo-DDV/Towk/issues/1261)) ([15553e7](https://github.com/Yo-DDV/Towk/commit/15553e7ef49c02f6bb9d3396fb76fe890c0482da))
* **assets:** recover physical deletion from events ([#1394](https://github.com/Yo-DDV/Towk/issues/1394)) ([e278db2](https://github.com/Yo-DDV/Towk/commit/e278db20144259b011dc7966352dad5caadd73a2))
* **assets:** serve protected assets through stable gateway ([#1264](https://github.com/Yo-DDV/Towk/issues/1264)) ([d4b8ad6](https://github.com/Yo-DDV/Towk/commit/d4b8ad6bed4b27f9ee4e5f65871d52e6654f6c7f))
* **attachments:** crop extreme image thumbnails ([#1181](https://github.com/Yo-DDV/Towk/issues/1181)) ([4807491](https://github.com/Yo-DDV/Towk/commit/4807491b916cf1097ef58789d8e44d1f565a338f))
* **auth:** add structured unauthenticated GraphQL errors ([#1048](https://github.com/Yo-DDV/Towk/issues/1048)) ([0ce9f17](https://github.com/Yo-DDV/Towk/commit/0ce9f17ad818ee25186ae77cebeb9fd6cdb216a1))
* **auth:** make CSRF tokens stateless ([#900](https://github.com/Yo-DDV/Towk/issues/900)) ([00a9b0e](https://github.com/Yo-DDV/Towk/commit/00a9b0efe92d8cfebbab4877f517a931c0140462))
* **auth:** preserve sessions during storage outages ([#1431](https://github.com/Yo-DDV/Towk/issues/1431)) ([fe101fa](https://github.com/Yo-DDV/Towk/commit/fe101fa07bfdaff7076ce2849d24a087a18cbefd))
* **auth:** reject empty-user runtime credentials ([#1201](https://github.com/Yo-DDV/Towk/issues/1201)) ([80fe374](https://github.com/Yo-DDV/Towk/commit/80fe374390cdd44d1c161c7966dd1d9bb4222703))
* **auth:** stabilize cookie session auth ([#883](https://github.com/Yo-DDV/Towk/issues/883)) ([38e0c13](https://github.com/Yo-DDV/Towk/commit/38e0c13e6291678f434cb00576bb0fa8ec63a7d7))
* backfill sparse room timelines ([#1353](https://github.com/Yo-DDV/Towk/issues/1353)) ([d0ab10f](https://github.com/Yo-DDV/Towk/commit/d0ab10f713c236ea82c52ee2652ba2d2b0a2a56c))
* **backup:** harden archive creation and restore ([#1435](https://github.com/Yo-DDV/Towk/issues/1435)) ([ffbb678](https://github.com/Yo-DDV/Towk/commit/ffbb6782c7bc443364b626ae972b867aaff0e844))
* **backup:** synchronize snapshot progress ([#16](https://github.com/Yo-DDV/Towk/issues/16)) ([1c1ff00](https://github.com/Yo-DDV/Towk/commit/1c1ff00ad400452fb944b5a8ffa6e7023a3a1fca))
* **calls:** improve LiveKit join resilience ([#1022](https://github.com/Yo-DDV/Towk/issues/1022)) ([0291caa](https://github.com/Yo-DDV/Towk/commit/0291caafe4f8030d9e7f8bc7bc3040d28779ccf0))
* **calls:** preserve call on tab takeover ([#1284](https://github.com/Yo-DDV/Towk/issues/1284)) ([8d503d1](https://github.com/Yo-DDV/Towk/commit/8d503d1f3e5a603307e1b700e0d07eb8fc50a934))
* **ci:** checkout docs image PR refs ([#906](https://github.com/Yo-DDV/Towk/issues/906)) ([a3acc5f](https://github.com/Yo-DDV/Towk/commit/a3acc5fc2d92aa12d53d0c85bbd4b5dc5752a3ad))
* **ci:** gate release-please on green ci ([#1135](https://github.com/Yo-DDV/Towk/issues/1135)) ([fdfa430](https://github.com/Yo-DDV/Towk/commit/fdfa4300dd5896aeea9f27929e86297ddeb232e7))
* **ci:** harden workflow permissions ([19fad5a](https://github.com/Yo-DDV/Towk/commit/19fad5a67722bd2224216b3a53e571c8fe6bc54f))
* **ci:** harden workflow permissions ([65699d4](https://github.com/Yo-DDV/Towk/commit/65699d46e3f36b7cadf4416f81b39c76b522e0a2))
* **ci:** isolate CodeQL Go build cache ([e2e776a](https://github.com/Yo-DDV/Towk/commit/e2e776a887895bc5ea569776ec608e87ac892cc7))
* **ci:** repair Towk validation checks ([0cdca37](https://github.com/Yo-DDV/Towk/commit/0cdca3708927c0c69fe3669f5ac3cc48193dd6ca))
* **ci:** run Docker actions on Node.js 24 ([0682231](https://github.com/Yo-DDV/Towk/commit/0682231911d51cf50bb1345b3907390bd25b1635))
* **ci:** use CodeQL Go autobuild ([3de14de](https://github.com/Yo-DDV/Towk/commit/3de14deb1b3165dbe70da12f3b23b2fd3977428f))
* **ci:** verify published image digests ([ed6ac0e](https://github.com/Yo-DDV/Towk/commit/ed6ac0eeca6f89b06c7f3a5e81d9ff3ff0d938e1))
* **cli:** keep passphrases out of argv ([#20](https://github.com/Yo-DDV/Towk/issues/20)) ([1f6b680](https://github.com/Yo-DDV/Towk/commit/1f6b680f878fecc4be98d152358b778cadb4151e))
* **compose:** restrict service runtimes ([#23](https://github.com/Yo-DDV/Towk/issues/23)) ([9b40e3a](https://github.com/Yo-DDV/Towk/commit/9b40e3a585381b5875b7a4db5bb033697dbf9ca2))
* **composer:** keep autolink boundaries editable ([#964](https://github.com/Yo-DDV/Towk/issues/964)) ([28a4230](https://github.com/Yo-DDV/Towk/commit/28a4230f53c58bac7d0ffffe1eb12112814c4da7))
* **composer:** preserve trailing hashes in headings ([#967](https://github.com/Yo-DDV/Towk/issues/967)) ([fff7da4](https://github.com/Yo-DDV/Towk/commit/fff7da44985cf1292c92a6ea1a4d30969ad27ffe))
* **conductor:** use workspace port for Storybook ([#1290](https://github.com/Yo-DDV/Towk/issues/1290)) ([0a395da](https://github.com/Yo-DDV/Towk/commit/0a395da50d5f9988a57090d96652fb4d2a9b6c80))
* **connectapi:** harden message post migration ([#1097](https://github.com/Yo-DDV/Towk/issues/1097)) ([881b095](https://github.com/Yo-DDV/Towk/commit/881b0952d56b90a2c8cb2c42898da8c32627a8fe))
* **connectapi:** harden timeline and thread read handling ([#1117](https://github.com/Yo-DDV/Towk/issues/1117)) ([fedf0ca](https://github.com/Yo-DDV/Towk/commit/fedf0ca82fcef36cbca4a283c879e8e4c9819592))
* **connectrpc:** cap request message size ([#1102](https://github.com/Yo-DDV/Towk/issues/1102)) ([7f5fd94](https://github.com/Yo-DDV/Towk/commit/7f5fd943d4e2ec9b8a3cda9ee04c020fa9b5e9e8))
* **connectrpc:** reject missing read anchors ([#1109](https://github.com/Yo-DDV/Towk/issues/1109)) ([b8b1521](https://github.com/Yo-DDV/Towk/commit/b8b152119082951874b1730095ec3bfbdecc446c))
* **core:** complete service inventory metrics ([#1130](https://github.com/Yo-DDV/Towk/issues/1130)) ([a170ab2](https://github.com/Yo-DDV/Towk/commit/a170ab2925ac5da7f3a3831fa99060966c2fee1d))
* **core:** prevent read marker regressions ([#1107](https://github.com/Yo-DDV/Towk/issues/1107)) ([d8e6aa8](https://github.com/Yo-DDV/Towk/commit/d8e6aa8ca7a211c840513deeb00b410b1da49616))
* **core:** remove room leavers from voice calls ([#1373](https://github.com/Yo-DDV/Towk/issues/1373)) ([2ef9977](https://github.com/Yo-DDV/Towk/commit/2ef99770faf89e6a93454f27ad3a1640d548f99d))
* correct push notification deep links ([#982](https://github.com/Yo-DDV/Towk/issues/982)) ([e14c49c](https://github.com/Yo-DDV/Towk/commit/e14c49cc3b6fb748c29d0c43f6d47c336f1045cf))
* **dockercompose:** enable LiveKit TURN relay ([#1190](https://github.com/Yo-DDV/Towk/issues/1190)) ([2e88dc5](https://github.com/Yo-DDV/Towk/commit/2e88dc5a83decd90e1c62bc8ec9d88b35b267d14))
* **docker:** support read-only root filesystems ([#1403](https://github.com/Yo-DDV/Towk/issues/1403)) ([b8c41a0](https://github.com/Yo-DDV/Towk/commit/b8c41a021c9e4a135f9eb5ff5c08dedd203776c8))
* **docker:** use config and data root paths ([#903](https://github.com/Yo-DDV/Towk/issues/903)) ([0050915](https://github.com/Yo-DDV/Towk/commit/00509150d3fb35cfd4a0641d857c154f3230c447))
* **docs:** add community chat link ([#1344](https://github.com/Yo-DDV/Towk/issues/1344)) ([45795a9](https://github.com/Yo-DDV/Towk/commit/45795a98e9a8fdf5d7ebacdf98d71ec042e50eda))
* **docs:** add per-page social previews ([#1370](https://github.com/Yo-DDV/Towk/issues/1370)) ([abe0fa1](https://github.com/Yo-DDV/Towk/commit/abe0fa1a8f20a1926d148da3e0c9675e1ef4ee0b))
* **docs:** correct deployment guide redirect ([#1395](https://github.com/Yo-DDV/Towk/issues/1395)) ([23d258a](https://github.com/Yo-DDV/Towk/commit/23d258addc6beae5d8b19963d87c8e9b6ef50935))
* **docs:** keep release note cards in grid lanes ([#1204](https://github.com/Yo-DDV/Towk/issues/1204)) ([383a9f2](https://github.com/Yo-DDV/Towk/commit/383a9f2edd94476c795d113ac793c21425edb8fb))
* downgrade invalid session cookie logs ([#1029](https://github.com/Yo-DDV/Towk/issues/1029)) ([bc49d87](https://github.com/Yo-DDV/Towk/commit/bc49d872ff005b7ed7d62c963af3e26db6c61574))
* **e2e:** wait for posted message articles ([#923](https://github.com/Yo-DDV/Towk/issues/923)) ([111a601](https://github.com/Yo-DDV/Towk/commit/111a601db8fd2fd4dce034f5d0b83955f42ad105))
* **frontend:** add embed frame vertical spacing ([#976](https://github.com/Yo-DDV/Towk/issues/976)) ([90fd64d](https://github.com/Yo-DDV/Towk/commit/90fd64d3e04586ad7a455ba4135035e4e8b84d06))
* **frontend:** add optimistic reactions ([#1349](https://github.com/Yo-DDV/Towk/issues/1349)) ([de43ae4](https://github.com/Yo-DDV/Towk/commit/de43ae4e032c25f8b3d9ab19dcb5f714efb85369))
* **frontend:** add optimistic room reads ([#1376](https://github.com/Yo-DDV/Towk/issues/1376)) ([90dd904](https://github.com/Yo-DDV/Towk/commit/90dd904957cb324191b28097bd4e28f54d32c640))
* **frontend:** address svelte guidance review ([#1154](https://github.com/Yo-DDV/Towk/issues/1154)) ([d3f8e4e](https://github.com/Yo-DDV/Towk/commit/d3f8e4ea885d527e0976f5caec87b6c47ffc34ce))
* **frontend:** adopt menu shell for toasts ([#1323](https://github.com/Yo-DDV/Towk/issues/1323)) ([2e0c517](https://github.com/Yo-DDV/Towk/commit/2e0c5170a2e97b615b06f894a20fd8904e3d824c))
* **frontend:** align call control button colors ([#1085](https://github.com/Yo-DDV/Towk/issues/1085)) ([29113cd](https://github.com/Yo-DDV/Towk/commit/29113cdf3cf6e248c59347cda08cb6a84ef065df))
* **frontend:** align chat control border radii ([#968](https://github.com/Yo-DDV/Towk/issues/968)) ([9fde02e](https://github.com/Yo-DDV/Towk/commit/9fde02e0454c6d5837bcd85b00d1c8dc9a822ed5))
* **frontend:** align message footer row spacing ([#1331](https://github.com/Yo-DDV/Towk/issues/1331)) ([6565605](https://github.com/Yo-DDV/Towk/commit/65656052a0b1ae57298053b59718389675708674))
* **frontend:** align muted call participant icon ([#1050](https://github.com/Yo-DDV/Towk/issues/1050)) ([35fc9be](https://github.com/Yo-DDV/Towk/commit/35fc9be0f73cd4cd131cfcfca0ef85e31ff1faf7))
* **frontend:** allow any file in attachment picker ([#1364](https://github.com/Yo-DDV/Towk/issues/1364)) ([6454094](https://github.com/Yo-DDV/Towk/commit/6454094edec9c52f8f781509bd7a70c8001b923c))
* **frontend:** clarify echo reply actions ([#1253](https://github.com/Yo-DDV/Towk/issues/1253)) ([db36374](https://github.com/Yo-DDV/Towk/commit/db3637404ce6724f1a23b8386ec0a97c778fb3d0))
* **frontend:** clarify iOS PWA push setup ([#1192](https://github.com/Yo-DDV/Towk/issues/1192)) ([12d0558](https://github.com/Yo-DDV/Towk/commit/12d05589c488051ce77d95dcc3cdcbbd0b474cab))
* **frontend:** clarify remote push notification support ([#1105](https://github.com/Yo-DDV/Towk/issues/1105)) ([3d343a3](https://github.com/Yo-DDV/Towk/commit/3d343a3b4e961a61a5fe0f1c296fdc3d143495aa))
* **frontend:** clear call-wide mode on notification navigation ([#1291](https://github.com/Yo-DDV/Towk/issues/1291)) ([c16652a](https://github.com/Yo-DDV/Towk/commit/c16652a19a34b94b0dcea6dfef1d159560a1d856))
* **frontend:** clear stale mention autocomplete state ([#1015](https://github.com/Yo-DDV/Towk/issues/1015)) ([3f1aedf](https://github.com/Yo-DDV/Towk/commit/3f1aedf2af81af25ad3ff6051f117584cf754d13))
* **frontend:** compress displayed images ([#1361](https://github.com/Yo-DDV/Towk/issues/1361)) ([b3adac1](https://github.com/Yo-DDV/Towk/commit/b3adac134dd71ff6e995f22a8af58d80ed80500c))
* **frontend:** confirm mention autocomplete with enter ([1ba6829](https://github.com/Yo-DDV/Towk/commit/1ba682954c3cc7f056e60ed1ed6645b8ee1da769))
* **frontend:** constrain current user card height ([#1239](https://github.com/Yo-DDV/Towk/issues/1239)) ([3db6ab3](https://github.com/Yo-DDV/Towk/commit/3db6ab31c49b1274ff8163a547206e0170d4b251))
* **frontend:** defer camera permission until enabled ([#1243](https://github.com/Yo-DDV/Towk/issues/1243)) ([c17b948](https://github.com/Yo-DDV/Towk/commit/c17b94875807db895f7c6fd8fc18e4ced641f078))
* **frontend:** defer unread separator until return to the room ([#1079](https://github.com/Yo-DDV/Towk/issues/1079)) ([014606b](https://github.com/Yo-DDV/Towk/commit/014606be00b73bb00a4c33f5b66bdf5f23264d98))
* **frontend:** eagerly load room members ([#1009](https://github.com/Yo-DDV/Towk/issues/1009)) ([fd70c2d](https://github.com/Yo-DDV/Towk/commit/fd70c2de7a5df13bcd12555aa417194afbba9db4))
* **frontend:** echo local room posts after send ([#980](https://github.com/Yo-DDV/Towk/issues/980)) ([730ee17](https://github.com/Yo-DDV/Towk/commit/730ee17455f7ebecc4b68231b95e91f497845415))
* **frontend:** handle API auth failures gracefully ([#1269](https://github.com/Yo-DDV/Towk/issues/1269)) ([56b7394](https://github.com/Yo-DDV/Towk/commit/56b73941dfa17cd7564107af9e9b0f2588ed0ace))
* **frontend:** harden asset proxy token handling ([#1054](https://github.com/Yo-DDV/Towk/issues/1054)) ([45290e8](https://github.com/Yo-DDV/Towk/commit/45290e8bfc23713d539c6ceb71af0962b81569b1))
* **frontend:** harden login redirect path validation ([#1340](https://github.com/Yo-DDV/Towk/issues/1340)) ([6331785](https://github.com/Yo-DDV/Towk/commit/6331785f7486e81ded6fc5bf3c70b224a1fc58ce))
* **frontend:** hydrate room lifecycle event actors ([#1319](https://github.com/Yo-DDV/Towk/issues/1319)) ([35ace65](https://github.com/Yo-DDV/Towk/commit/35ace65943806a949f727b63e098c376114ce029))
* **frontend:** ignore stale DM member loads when switching rooms ([#1065](https://github.com/Yo-DDV/Towk/issues/1065)) ([5f2b984](https://github.com/Yo-DDV/Towk/commit/5f2b9844402b84496e9e79067399b5d877ee35a2))
* **frontend:** improve blockquote styling ([#973](https://github.com/Yo-DDV/Towk/issues/973)) ([4abe764](https://github.com/Yo-DDV/Towk/commit/4abe7643666e67dff7d31cd3949a01f8c1553860))
* **frontend:** improve call presence indicators ([#1257](https://github.com/Yo-DDV/Towk/issues/1257)) ([b171f83](https://github.com/Yo-DDV/Towk/commit/b171f83432daa8ffc8f8f9c7639b14336373310c))
* **frontend:** improve chat link navigation ([#1333](https://github.com/Yo-DDV/Towk/issues/1333)) ([3ad3c01](https://github.com/Yo-DDV/Towk/commit/3ad3c0116dbb19ee2aef2966c24b0ea376de3e62))
* **frontend:** improve extreme image thumbnails ([#1227](https://github.com/Yo-DDV/Towk/issues/1227)) ([3eda26b](https://github.com/Yo-DDV/Towk/commit/3eda26b23aeb24f973e3e2577259bc26e4e2f4b7))
* **frontend:** improve LiveKit media error handling ([#1281](https://github.com/Yo-DDV/Towk/issues/1281)) ([5cced5e](https://github.com/Yo-DDV/Towk/commit/5cced5e93f80988939c8164dd866eb2bccd22a2f))
* **frontend:** improve reaction user popovers ([#1328](https://github.com/Yo-DDV/Towk/issues/1328)) ([d1168fc](https://github.com/Yo-DDV/Towk/commit/d1168fc44e8904a41626f7c3bb5357059a8b949c))
* **frontend:** improve unread channel contrast ([#1089](https://github.com/Yo-DDV/Towk/issues/1089)) ([1bbce8a](https://github.com/Yo-DDV/Towk/commit/1bbce8a225bf72fbe08bfb6a3723f41e47a96463))
* **frontend:** keep sidebars visible on fresh sessions ([#891](https://github.com/Yo-DDV/Towk/issues/891)) ([f6d85ac](https://github.com/Yo-DDV/Towk/commit/f6d85acb51a632bd643d26ebdd50c69047890ba7))
* **frontend:** keep signed-out servers navigable ([#1397](https://github.com/Yo-DDV/Towk/issues/1397)) ([5ac388d](https://github.com/Yo-DDV/Towk/commit/5ac388d6d660688208b9bcca67bb24e87be65449))
* **frontend:** link deployed version to source ([5ea441c](https://github.com/Yo-DDV/Towk/commit/5ea441c7a7ce00aec2ef9350fe71aa027584a6cc))
* **frontend:** link deployed version to source ([142b680](https://github.com/Yo-DDV/Towk/commit/142b6800c8897bb5398363e98fc7644d324f263f))
* **frontend:** localize date formatting ([#1242](https://github.com/Yo-DDV/Towk/issues/1242)) ([5f3e08c](https://github.com/Yo-DDV/Towk/commit/5f3e08cfeb3dbfe9705d0caebd5f0dfae01ddc27))
* **frontend:** localize edited message marker ([503f603](https://github.com/Yo-DDV/Towk/commit/503f6039a9dc55244f7d3085a577d1c8f8a54af9))
* **frontend:** make attachment remove control subtle ([#1265](https://github.com/Yo-DDV/Towk/issues/1265)) ([dbef775](https://github.com/Yo-DDV/Towk/commit/dbef775784313c1a599e287b842021078fe68f92))
* **frontend:** make scrollbars follow selected theme ([#1152](https://github.com/Yo-DDV/Towk/issues/1152)) ([5a1c0c9](https://github.com/Yo-DDV/Towk/commit/5a1c0c9c989c891927c7de058e076d04ce39a831))
* **frontend:** make thread badges native links ([#1020](https://github.com/Yo-DDV/Towk/issues/1020)) ([cb57d31](https://github.com/Yo-DDV/Towk/commit/cb57d31817266c4bccdc8769d8c0684ce114caf9))
* **frontend:** polish error and missing media states ([#1267](https://github.com/Yo-DDV/Towk/issues/1267)) ([2630cca](https://github.com/Yo-DDV/Towk/commit/2630cca493d3cc32a5a05ad0d86feecb6c5ab82e))
* **frontend:** preserve nested reply quotes ([#1000](https://github.com/Yo-DDV/Towk/issues/1000)) ([7d88452](https://github.com/Yo-DDV/Towk/commit/7d884523a4aaac2fa421d8426a1551e8421d453d))
* **frontend:** preserve optimistic reads across refresh ([#1393](https://github.com/Yo-DDV/Towk/issues/1393)) ([77019a7](https://github.com/Yo-DDV/Towk/commit/77019a7932f452d3d8ec3510d8704f8143bf0e55))
* **frontend:** preserve touch composer line breaks ([#1194](https://github.com/Yo-DDV/Towk/issues/1194)) ([3bba510](https://github.com/Yo-DDV/Towk/commit/3bba510345fd567770fd1e50cd2c25846c4f004f))
* **frontend:** prevent room badge clipping ([#1012](https://github.com/Yo-DDV/Towk/issues/1012)) ([7455ba3](https://github.com/Yo-DDV/Towk/commit/7455ba313612776068c93526d73bae0fb8eef3c3))
* **frontend:** quiet console warning noise ([#1280](https://github.com/Yo-DDV/Towk/issues/1280)) ([1664a8e](https://github.com/Yo-DDV/Towk/commit/1664a8ed5e03ebbab254863b53b476e02f03fc4a))
* **frontend:** reconcile notification badge dismissals ([#1058](https://github.com/Yo-DDV/Towk/issues/1058)) ([8db2926](https://github.com/Yo-DDV/Towk/commit/8db2926aae98d37789d606de66f1fa695372f37b))
* **frontend:** reconcile PWA notification badges ([#1229](https://github.com/Yo-DDV/Towk/issues/1229)) ([7c4364b](https://github.com/Yo-DDV/Towk/commit/7c4364b07b36aa5aadbbfdcbf637c90a30383f8c))
* **frontend:** refresh inherited server branding ([ce92edb](https://github.com/Yo-DDV/Towk/commit/ce92edbc63189c5db092cb72fc47b95101c9920a))
* **frontend:** refresh inherited server branding ([198097e](https://github.com/Yo-DDV/Towk/commit/198097e59e42fd611246d0aa97c8732d2484103d))
* **frontend:** refresh messages after local deletions ([#1148](https://github.com/Yo-DDV/Towk/issues/1148)) ([06d9c57](https://github.com/Yo-DDV/Towk/commit/06d9c578d762dff01f679f6fe1c550ea2c1be342))
* **frontend:** refresh recent emoji quick reactions ([#1327](https://github.com/Yo-DDV/Towk/issues/1327)) ([67e7b88](https://github.com/Yo-DDV/Towk/commit/67e7b88b55bd66bd67675a8717baf2305ff53718))
* **frontend:** remember last visited DM rooms ([#894](https://github.com/Yo-DDV/Towk/issues/894)) ([cbf0c5c](https://github.com/Yo-DDV/Towk/commit/cbf0c5c1155677eeabc16aaad357aaf36b59b25e))
* **frontend:** remount room on notification switch ([#908](https://github.com/Yo-DDV/Towk/issues/908)) ([a1aba5b](https://github.com/Yo-DDV/Towk/commit/a1aba5b719c03192c6e01effe53c1b4391da6472))
* **frontend:** remove redundant universal room badge ([#1052](https://github.com/Yo-DDV/Towk/issues/1052)) ([a966710](https://github.com/Yo-DDV/Towk/commit/a96671080dd94da15c9f28535f5b4235f2f7044c))
* **frontend:** remove server name from room header ([#979](https://github.com/Yo-DDV/Towk/issues/979)) ([614953b](https://github.com/Yo-DDV/Towk/commit/614953b1d57eb63c476fc15460e5162b939bbea6))
* **frontend:** render inline room join screen ([#1335](https://github.com/Yo-DDV/Towk/issues/1335)) ([d2f0d4c](https://github.com/Yo-DDV/Towk/commit/d2f0d4ca49d5c1bbf50cf647bee15e9967061c38))
* **frontend:** reset inline code state when composer clears ([#1251](https://github.com/Yo-DDV/Towk/issues/1251)) ([6327826](https://github.com/Yo-DDV/Towk/commit/63278267ab9401f6bf6f0151b9f94296a79cc0cc))
* **frontend:** respect browser region in timestamps ([#1387](https://github.com/Yo-DDV/Towk/issues/1387)) ([cf9e14f](https://github.com/Yo-DDV/Towk/commit/cf9e14f391e800f8af5b804fd7a30032c4a39fa2))
* **frontend:** restore circular avatars with stable presence dots ([#1252](https://github.com/Yo-DDV/Towk/issues/1252)) ([2219635](https://github.com/Yo-DDV/Towk/commit/221963528e5da9837c61b9448add6530a10d3e2e))
* **frontend:** restore default text smoothing ([#1268](https://github.com/Yo-DDV/Towk/issues/1268)) ([5643eff](https://github.com/Yo-DDV/Towk/commit/5643eff4ad3811c784c9f2979bca71da258e0404))
* **frontend:** restore push notification routing ([#957](https://github.com/Yo-DDV/Towk/issues/957)) ([93828ec](https://github.com/Yo-DDV/Towk/commit/93828ec07e2d75fe849441cfb6328feb6c70f49a))
* **frontend:** restrict same-tab message links ([#1068](https://github.com/Yo-DDV/Towk/issues/1068)) ([5646322](https://github.com/Yo-DDV/Towk/commit/5646322ee9a86d894f9e5bdde471209de9bd95a1))
* **frontend:** restyle reply attribution preview ([#1140](https://github.com/Yo-DDV/Towk/issues/1140)) ([bacfd36](https://github.com/Yo-DDV/Towk/commit/bacfd36abd5c4458dae7763d93a6df6c30e42770))
* **frontend:** route room badges from scoped notifications ([#972](https://github.com/Yo-DDV/Towk/issues/972)) ([15a130c](https://github.com/Yo-DDV/Towk/commit/15a130ce51e4c0749632821c25ba5eab54d43e50))
* **frontend:** separate input mode from viewport size ([#1339](https://github.com/Yo-DDV/Towk/issues/1339)) ([4ec631c](https://github.com/Yo-DDV/Towk/commit/4ec631ca440057ac5a0ea5466d46ba3df82d4d51))
* **frontend:** share unread marker lifecycle with threads ([#1310](https://github.com/Yo-DDV/Towk/issues/1310)) ([dd4806e](https://github.com/Yo-DDV/Towk/commit/dd4806e590e15b7873aabc51d6f13775dc95bcb5))
* **frontend:** show active call badges for DMs ([#899](https://github.com/Yo-DDV/Towk/issues/899)) ([2fc08c4](https://github.com/Yo-DDV/Towk/commit/2fc08c4c4529723b45d1c543b460225c0d5ba24d))
* **frontend:** show loading state for call media toggles ([#1237](https://github.com/Yo-DDV/Towk/issues/1237)) ([9f2e12f](https://github.com/Yo-DDV/Towk/commit/9f2e12f535ea0b231ddbbaf2a472c1a2c30d6804))
* **frontend:** show server logo before login ([#1416](https://github.com/Yo-DDV/Towk/issues/1416)) ([e54dbb5](https://github.com/Yo-DDV/Towk/commit/e54dbb58e4833e2c9c8b9df738df8420ce643d05))
* **frontend:** simplify push notification click routing ([#1322](https://github.com/Yo-DDV/Towk/issues/1322)) ([01ffef1](https://github.com/Yo-DDV/Towk/commit/01ffef1999d0518d8e42a25cdffd1d92e89ba3fd))
* **frontend:** simplify room resume catch-up ([#1332](https://github.com/Yo-DDV/Towk/issues/1332)) ([63db7de](https://github.com/Yo-DDV/Towk/commit/63db7de23832038fdbd46c7e724e56125bf8069c))
* **frontend:** stabilize linked-message navigation ([#1421](https://github.com/Yo-DDV/Towk/issues/1421)) ([641451a](https://github.com/Yo-DDV/Towk/commit/641451a77c7e46887d09167cfcfd19a91acf1dbc))
* **frontend:** stabilize mobile sidebar gestures ([#1324](https://github.com/Yo-DDV/Towk/issues/1324)) ([5ca7b0c](https://github.com/Yo-DDV/Towk/commit/5ca7b0cd482553c3eaa9ccd01ef577504c4122b0))
* **frontend:** stabilize new messages separator ([#1308](https://github.com/Yo-DDV/Towk/issues/1308)) ([c05c8e1](https://github.com/Yo-DDV/Towk/commit/c05c8e1158b877d567494f701263bd1ff8533e13))
* **frontend:** stabilize tab resume catch-up ([#1288](https://github.com/Yo-DDV/Towk/issues/1288)) ([26d0fda](https://github.com/Yo-DDV/Towk/commit/26d0fda8bbcb10c90a917bd0ac0892173f930a6a))
* **frontend:** stabilize unread and resume refresh ([#1346](https://github.com/Yo-DDV/Towk/issues/1346)) ([6a166a6](https://github.com/Yo-DDV/Towk/commit/6a166a65a862688267e2acaacc18df5efc1a29c9))
* **frontend:** style room member search clear button ([#1226](https://github.com/Yo-DDV/Towk/issues/1226)) ([0c4645f](https://github.com/Yo-DDV/Towk/commit/0c4645f9ac3a52357a75022a7099d259bf3548f3))
* **frontend:** submit simple message edits with enter ([#1129](https://github.com/Yo-DDV/Towk/issues/1129)) ([6b6d1fc](https://github.com/Yo-DDV/Towk/commit/6b6d1fc067a2c00624295214935afe78b638f870))
* **frontend:** support file drops in threads ([#1417](https://github.com/Yo-DDV/Towk/issues/1417)) ([e5b3731](https://github.com/Yo-DDV/Towk/commit/e5b3731e5426b8f19a690e4c8bd7dc72ab040070))
* **frontend:** sync presence badge across tabs ([#1301](https://github.com/Yo-DDV/Towk/issues/1301)) ([502ae8a](https://github.com/Yo-DDV/Towk/commit/502ae8ad0dc545940fac71dd74fa62a1340e5c11))
* **frontend:** sync room thread follow bell state ([#1121](https://github.com/Yo-DDV/Towk/issues/1121)) ([5706050](https://github.com/Yo-DDV/Towk/commit/5706050e8c7ef7172c19dbfb8b15bcffb8a8caa2))
* **frontend:** tighten mobile message action sheet ([#981](https://github.com/Yo-DDV/Towk/issues/981)) ([45c2852](https://github.com/Yo-DDV/Towk/commit/45c2852b3ac54f785cb5770c43be6604b41a2a98))
* **frontend:** unify user card presence source ([#1334](https://github.com/Yo-DDV/Towk/issues/1334)) ([9bcc2b0](https://github.com/Yo-DDV/Towk/commit/9bcc2b07513f75df82db18f768019a3a1d7bca16))
* **frontend:** use app modal for mention confirmation ([#927](https://github.com/Yo-DDV/Towk/issues/927)) ([b44f191](https://github.com/Yo-DDV/Towk/commit/b44f191e7a0a43509b278a4acb588a601872b3cc))
* **frontend:** use direct ticketed asset URLs ([#1312](https://github.com/Yo-DDV/Towk/issues/1312)) ([6b5ecb9](https://github.com/Yo-DDV/Towk/commit/6b5ecb937cbced120690efdcb04882be2cb3ddf0))
* **frontend:** use full-width image galleries ([#1247](https://github.com/Yo-DDV/Towk/issues/1247)) ([f3e6888](https://github.com/Yo-DDV/Towk/commit/f3e68883373187f17536eea6089aa9357b7754f3))
* **frontend:** use opaque PWA install icons ([#1352](https://github.com/Yo-DDV/Towk/issues/1352)) ([f379165](https://github.com/Yo-DDV/Towk/commit/f379165b674d089d8543d9146e61da7967a0203d))
* **frontend:** use semantic presence colors ([#1259](https://github.com/Yo-DDV/Towk/issues/1259)) ([6dc90a8](https://github.com/Yo-DDV/Towk/commit/6dc90a8fb9ec495e967d517e8acfbba7c3243ef1))
* **frontend:** wire UI strings to i18n ([#1225](https://github.com/Yo-DDV/Towk/issues/1225)) ([59483de](https://github.com/Yo-DDV/Towk/commit/59483def9cc47fc8ce309c2af56f29afd08a194a))
* **graphql:** enforce room move group permissions ([#987](https://github.com/Yo-DDV/Towk/issues/987)) ([35d6011](https://github.com/Yo-DDV/Towk/commit/35d60114b3a2a89ff50d4309e9cc281c1598397c))
* hide call lifecycle events from room history ([#1017](https://github.com/Yo-DDV/Towk/issues/1017)) ([1632446](https://github.com/Yo-DDV/Towk/commit/1632446d2ddcd66b6f61e433efa576c625d33f34))
* improve push notification routing ([#1031](https://github.com/Yo-DDV/Towk/issues/1031)) ([49aee89](https://github.com/Yo-DDV/Towk/commit/49aee89a3b5271b757698fb49066aceb86e075e5))
* **init:** create config exclusively ([#18](https://github.com/Yo-DDV/Towk/issues/18)) ([ced95eb](https://github.com/Yo-DDV/Towk/commit/ced95eb0065aff2f24f321749c26575e6c0c2788))
* **k8s:** restrict the deployment example ([#22](https://github.com/Yo-DDV/Towk/issues/22)) ([cfddb99](https://github.com/Yo-DDV/Towk/commit/cfddb993f534836a8a6d36191bdce148dcf73379))
* **keys:** publish exports atomically ([#17](https://github.com/Yo-DDV/Towk/issues/17)) ([b9c1b6c](https://github.com/Yo-DDV/Towk/commit/b9c1b6c264c666bd17bc693d2474307f3df6d38c))
* **keys:** tolerate mixed export records ([#19](https://github.com/Yo-DDV/Towk/issues/19)) ([e95ad78](https://github.com/Yo-DDV/Towk/commit/e95ad78bd78762fb83f344e31e1d58535118f35b))
* log graphql errors ([#955](https://github.com/Yo-DDV/Towk/issues/955)) ([2d753c9](https://github.com/Yo-DDV/Towk/commit/2d753c967ca42f4ab6f898322f5c8fb7b0a55e83))
* **media:** preserve video aspect ratios ([#1254](https://github.com/Yo-DDV/Towk/issues/1254)) ([16480b8](https://github.com/Yo-DDV/Towk/commit/16480b823b7f53da27e3b5a2f98c3069cfd421cd))
* **messages:** expire context-free tombstones ([#1365](https://github.com/Yo-DDV/Towk/issues/1365)) ([a919487](https://github.com/Yo-DDV/Towk/commit/a919487b0bcf4a42bef4a4bebe84fe172a5b476c))
* **messages:** validate reply targets before posting ([#1176](https://github.com/Yo-DDV/Towk/issues/1176)) ([3b2d52d](https://github.com/Yo-DDV/Towk/commit/3b2d52df3833e3f8d2920441a0075c7c0cab4574))
* **metrics:** track realtime websocket connections ([#1356](https://github.com/Yo-DDV/Towk/issues/1356)) ([8aafcac](https://github.com/Yo-DDV/Towk/commit/8aafcacc700d5ca2c29358f38b3317e478391b1b))
* **notifications:** clear read notifications server-side ([#1297](https://github.com/Yo-DDV/Towk/issues/1297)) ([6cb504d](https://github.com/Yo-DDV/Towk/commit/6cb504d718db7c3e4a02870f22b254dcad0ee25d))
* **notifications:** harden delivery and synchronization ([#1363](https://github.com/Yo-DDV/Towk/issues/1363)) ([5a9ba0c](https://github.com/Yo-DDV/Towk/commit/5a9ba0c88bf06e41a3bd62f8e1cfb2630d4c4ed0))
* **notifications:** preserve unread badge state across dismissals ([#1069](https://github.com/Yo-DDV/Towk/issues/1069)) ([037fd01](https://github.com/Yo-DDV/Towk/commit/037fd019263bdbc5ae71be291d868665e87d9b1b))
* **notifications:** prevent stale push delivery and badges ([#1368](https://github.com/Yo-DDV/Towk/issues/1368)) ([0c8aa3c](https://github.com/Yo-DDV/Towk/commit/0c8aa3c0e536882e30c1e548777fe94300a91561))
* **oauth:** keep authorization on the server origin ([#24](https://github.com/Yo-DDV/Towk/issues/24)) ([f2ea16d](https://github.com/Yo-DDV/Towk/commit/f2ea16d9a0ce3ca48a624316cffc56c35f886fdc))
* **push:** add declarative web push payloads ([#1338](https://github.com/Yo-DDV/Towk/issues/1338)) ([4514bfa](https://github.com/Yo-DDV/Towk/commit/4514bfa0e26d54108042d50aba6bfc024e01ccdb))
* **pwa:** reduce service worker reload churn ([#1187](https://github.com/Yo-DDV/Towk/issues/1187)) ([063f07a](https://github.com/Yo-DDV/Towk/commit/063f07adf45559a27eda0e3ea5e2bbfc2ca49f8b))
* **pwa:** stop preserving push badge hints ([#1343](https://github.com/Yo-DDV/Towk/issues/1343)) ([6842215](https://github.com/Yo-DDV/Towk/commit/684221588edea59ceed89520db32ead27ee42f10))
* **pwa:** use server logo for install icons ([#1371](https://github.com/Yo-DDV/Towk/issues/1371)) ([ac28ca6](https://github.com/Yo-DDV/Towk/commit/ac28ca6840894d5a16255ad58a187962381995e0))
* **reactions:** canonicalize echo reaction targets ([#1272](https://github.com/Yo-DDV/Towk/issues/1272)) ([91b2fb3](https://github.com/Yo-DDV/Towk/commit/91b2fb3d95e01c1b50ae3f5931b54ec1814ebd11))
* **read-state:** reduce no-op read signals ([#1330](https://github.com/Yo-DDV/Towk/issues/1330)) ([24ac448](https://github.com/Yo-DDV/Towk/commit/24ac448ca5a296009f605185e06f3501a5c0cdcc))
* **realtime:** align heartbeat cadence with client stall detection ([#1342](https://github.com/Yo-DDV/Towk/issues/1342)) ([4be0241](https://github.com/Yo-DDV/Towk/commit/4be024126966259b819b353d394092a292b7f392))
* **realtime:** bound websocket connections ([#21](https://github.com/Yo-DDV/Towk/issues/21)) ([44a75b3](https://github.com/Yo-DDV/Towk/commit/44a75b3495c58f18277797e2cd6ab5074eb31255))
* reconcile in-app notification badges ([#1008](https://github.com/Yo-DDV/Towk/issues/1008)) ([75e92ee](https://github.com/Yo-DDV/Towk/commit/75e92ee87518e7ae8d1f8c5bd5436cc667e3ca4d))
* refresh current room on reconnect ([#878](https://github.com/Yo-DDV/Towk/issues/878)) ([ae5857c](https://github.com/Yo-DDV/Towk/commit/ae5857c923e1a3a9d1e4c2e52f28f7b139dc694e))
* refresh room layout state after room creation ([#907](https://github.com/Yo-DDV/Towk/issues/907)) ([e371279](https://github.com/Yo-DDV/Towk/commit/e371279fd784451be23a4423cc0757fc9503592f))
* **release:** add next prerelease channel ([#1414](https://github.com/Yo-DDV/Towk/issues/1414)) ([a7a79f1](https://github.com/Yo-DDV/Towk/commit/a7a79f13c5e2bfe15cbba66178f04f3bc4c3d14e))
* **release:** create preparation PR as draft ([a7fcd92](https://github.com/Yo-DDV/Towk/commit/a7fcd92f270d08d599c087c0e333fc340069a9e4))
* **release:** create preparation PR as draft ([f340975](https://github.com/Yo-DDV/Towk/commit/f340975042344f0060fe15df4630a995ef49dbd6))
* **release:** embed frontend in Towk image ([4aaafa2](https://github.com/Yo-DDV/Towk/commit/4aaafa2e47f58b7473686285064967466d006ce9))
* **release:** embed frontend in Towk image ([ac4228e](https://github.com/Yo-DDV/Towk/commit/ac4228ecbd2c076c185512d39f2e6a8215483602))
* **release:** publish release before updating tap ([#1298](https://github.com/Yo-DDV/Towk/issues/1298)) ([885da8b](https://github.com/Yo-DDV/Towk/commit/885da8ba86b678296b664160379d5193db7971e2))
* **release:** restore Windows builds ([#1405](https://github.com/Yo-DDV/Towk/issues/1405)) ([5a923f1](https://github.com/Yo-DDV/Towk/commit/5a923f17002391e5d0c0421689f488ea55e1b377))
* remove graphql error logging ([#1026](https://github.com/Yo-DDV/Towk/issues/1026)) ([06ede4e](https://github.com/Yo-DDV/Towk/commit/06ede4e85984ba3649ad4761cc390bf501ce0a81))
* represent deleted room members ([#934](https://github.com/Yo-DDV/Towk/issues/934)) ([1d0236b](https://github.com/Yo-DDV/Towk/commit/1d0236b686447ef793edd715faf2b5ee5abab88d))
* **security:** bound link preview lifecycle ([#10](https://github.com/Yo-DDV/Towk/issues/10)) ([ba7709a](https://github.com/Yo-DDV/Towk/commit/ba7709aff908e96eb2680b354c6c9849af00bd92))
* **security:** bound message attachment references ([#14](https://github.com/Yo-DDV/Towk/issues/14)) ([34cff1e](https://github.com/Yo-DDV/Towk/commit/34cff1e25404e4123694da17179ef46362e856ba))
* **security:** bound runtime credential lifetimes ([#13](https://github.com/Yo-DDV/Towk/issues/13)) ([2280815](https://github.com/Yo-DDV/Towk/commit/2280815761105094a5a5d1efd5791b21e76c3162))
* **security:** enforce frontend browser policy ([#26](https://github.com/Yo-DDV/Towk/issues/26)) ([f18cb36](https://github.com/Yo-DDV/Towk/commit/f18cb367064fd5eac4dc986872239fea953fda23))
* **security:** harden account deletion ([#4](https://github.com/Yo-DDV/Towk/issues/4)) ([536bca4](https://github.com/Yo-DDV/Towk/commit/536bca4e5e6a83b84d655b613a607b90c957d38d))
* **security:** harden local artifact hygiene ([#25](https://github.com/Yo-DDV/Towk/issues/25)) ([1eb2c9b](https://github.com/Yo-DDV/Towk/commit/1eb2c9bbfe6706e3ae6e1a42aa03058a962e812e))
* **security:** harden realtime auth and request handling ([#1433](https://github.com/Yo-DDV/Towk/issues/1433)) ([9b3cac9](https://github.com/Yo-DDV/Towk/commit/9b3cac929336e54a8e7f486abe778d25cdd7a390))
* **security:** integrate upstream release hardening ([5cfe563](https://github.com/Yo-DDV/Towk/commit/5cfe56382f6abf0ab78511b2f929b3550522fd62))
* **security:** make account crypto-shredding recoverable ([#11](https://github.com/Yo-DDV/Towk/issues/11)) ([f828379](https://github.com/Yo-DDV/Towk/commit/f828379bac77742f1a5b87991ee8fcc4f91be477))
* **security:** make auth capabilities single-use ([#12](https://github.com/Yo-DDV/Towk/issues/12)) ([11d78c1](https://github.com/Yo-DDV/Towk/commit/11d78c19e223f02e8c28b5188fe2122dca53b266))
* **security:** protect the owner role boundary ([#20](https://github.com/Yo-DDV/Towk/issues/20)) ([9c1fd5f](https://github.com/Yo-DDV/Towk/commit/9c1fd5f080d9ec706db01e2f6209128d1dcc7807))
* **security:** rate limit authentication flows ([#6](https://github.com/Yo-DDV/Towk/issues/6)) ([059930e](https://github.com/Yo-DDV/Towk/commit/059930ed506eedac8498592fd8e354bc37908b59))
* **security:** rebuild bundled NATS CLI ([bfb383c](https://github.com/Yo-DDV/Towk/commit/bfb383cb7f76f89a1a5056a3485bc814092f0607))
* **security:** rebuild bundled NATS CLI ([db3c236](https://github.com/Yo-DDV/Towk/commit/db3c236aa33ad8c47a0b083abddd455997e59e1f))
* **security:** redact credentials from audit events ([#21](https://github.com/Yo-DDV/Towk/issues/21)) ([f16da78](https://github.com/Yo-DDV/Towk/commit/f16da78c75c42a5e2016cfde645c0208afa6ef5d))
* **security:** require TLS for external NATS ([#15](https://github.com/Yo-DDV/Towk/issues/15)) ([64c2d40](https://github.com/Yo-DDV/Towk/commit/64c2d40950764952cf11e6f6fade50cb65c2ed94))
* **security:** resolve CodeQL findings ([1bc7b74](https://github.com/Yo-DDV/Towk/commit/1bc7b743b25dcb58c82b0faeb95955b5fe130e7d))
* **security:** resolve CodeQL findings ([0327553](https://github.com/Yo-DDV/Towk/commit/0327553d4ef5f460c02af786118013b1fd0a90f4))
* **security:** restrict link previews to public addresses ([bd57e5a](https://github.com/Yo-DDV/Towk/commit/bd57e5a10947524c212dcceec5c1e3bae368a028))
* **security:** run frontend images without root ([#27](https://github.com/Yo-DDV/Towk/issues/27)) ([36080e9](https://github.com/Yo-DDV/Towk/commit/36080e9163bdb5eab7b18e1f9eed67a317a4c7c8))
* **security:** update vulnerable dependencies ([f676d35](https://github.com/Yo-DDV/Towk/commit/f676d356835344b8ad3689e600074f58c586efd6))
* **security:** update vulnerable dependencies ([950d6dc](https://github.com/Yo-DDV/Towk/commit/950d6dc240e239f3ceed42def4f56c9fb1a6698c))
* **server:** reduce routine info logs ([#1325](https://github.com/Yo-DDV/Towk/issues/1325)) ([241f181](https://github.com/Yo-DDV/Towk/commit/241f1818727fbd58b4160b09f9ad25c48c3d8d73))
* **sidebar:** server-local sidebar links now open in the same window ([#1041](https://github.com/Yo-DDV/Towk/issues/1041)) ([4ac8107](https://github.com/Yo-DDV/Towk/commit/4ac8107f0ace1d5add4662ceec2bc6bfb3d3e703))
* support configurable Docker runtime user ([#959](https://github.com/Yo-DDV/Towk/issues/959)) ([eafd657](https://github.com/Yo-DDV/Towk/commit/eafd657ccd3f4baaf1cade33e2bc5a2fec9df59b))
* support implicit SMTP TLS ([#905](https://github.com/Yo-DDV/Towk/issues/905)) ([52e16a5](https://github.com/Yo-DDV/Towk/commit/52e16a5ea60bc48cdb8059f4f850b1451816294f))
* tidy server lifecycle logs ([#914](https://github.com/Yo-DDV/Towk/issues/914)) ([8183af8](https://github.com/Yo-DDV/Towk/commit/8183af89dca8ba816959bdbf053a71742f0d6b51))
* tighten sidebar item spacing ([#975](https://github.com/Yo-DDV/Towk/issues/975)) ([a73109b](https://github.com/Yo-DDV/Towk/commit/a73109b2297e027930069a68d210736aaac5f6e0))
* tolerate stale room members ([#932](https://github.com/Yo-DDV/Towk/issues/932)) ([6600811](https://github.com/Yo-DDV/Towk/commit/660081108e5a4d035a1b5ac34bdcc14ed160844b))
* update thread replies after send ([#924](https://github.com/Yo-DDV/Towk/issues/924)) ([2b24183](https://github.com/Yo-DDV/Towk/commit/2b2418306521042c33798477355c2a93754b7549))
* **voice:** scope LiveKit observations to active calls ([#1049](https://github.com/Yo-DDV/Towk/issues/1049)) ([7e2baed](https://github.com/Yo-DDV/Towk/commit/7e2baed8c9578475131eb6ce7d1253fb856b1220))


### Performance Improvements

* add opt-in profiling diagnostics ([#1038](https://github.com/Yo-DDV/Towk/issues/1038)) ([aba923c](https://github.com/Yo-DDV/Towk/commit/aba923cb3e5d29d187bcbe3e1c4b5b156f9050f6))
* **build:** improve frontend and CLI cache reuse ([#1106](https://github.com/Yo-DDV/Towk/issues/1106)) ([c6c6e3a](https://github.com/Yo-DDV/Towk/commit/c6c6e3a5ba655af2b5ebb9b107b295580218c056))
* **core:** cache unwrapped DEKs per request ([#1193](https://github.com/Yo-DDV/Towk/issues/1193)) ([443711c](https://github.com/Yo-DDV/Towk/commit/443711cf0d04dc34fadb0f13a7df96cbf9524158))
* **core:** slim timeline projection memory ([#1287](https://github.com/Yo-DDV/Towk/issues/1287)) ([0a0c004](https://github.com/Yo-DDV/Towk/commit/0a0c0049594d29902ba19a877a3f5ccb3ebeec2c))
* fast-path projection stream sequence parsing ([#1042](https://github.com/Yo-DDV/Towk/issues/1042)) ([b7d1a1d](https://github.com/Yo-DDV/Towk/commit/b7d1a1da673470dc1b2ddd458b4def96bba43994))
* **frontend:** load room members in larger batches ([#1206](https://github.com/Yo-DDV/Towk/issues/1206)) ([c7d3e9a](https://github.com/Yo-DDV/Towk/commit/c7d3e9a053cf13629e7c1ebfbd3cbb9bccd42ac2))
* **frontend:** speed up large room member loading ([#1423](https://github.com/Yo-DDV/Towk/issues/1423)) ([0343238](https://github.com/Yo-DDV/Towk/commit/034323808f03e4a71dcbb6ccbe3b5232c48d2d27))
* **frontend:** split chat code from app chrome ([#1103](https://github.com/Yo-DDV/Towk/issues/1103)) ([d93c74c](https://github.com/Yo-DDV/Towk/commit/d93c74c399ed6ae84dd136e8fc55abfda8e188de))
* optimize projection dispatch matching ([#1040](https://github.com/Yo-DDV/Towk/issues/1040)) ([ef384cf](https://github.com/Yo-DDV/Towk/commit/ef384cf9fc165e8d72b14d2018974b1c1136355e))
* optimize projection replay and memory ([#1032](https://github.com/Yo-DDV/Towk/issues/1032)) ([d280893](https://github.com/Yo-DDV/Towk/commit/d2808933f7dde8658ec2b81986eb071d3131c2af))
* optimize projection startup paths ([#1005](https://github.com/Yo-DDV/Towk/issues/1005)) ([859290f](https://github.com/Yo-DDV/Towk/commit/859290f1e4745ce46217de0dda987104ab8f887c))
* **projections:** bound replay idempotency memory ([#1407](https://github.com/Yo-DDV/Towk/issues/1407)) ([d7a8d22](https://github.com/Yo-DDV/Towk/commit/d7a8d225553a387372d3ae30ab9a5acaf5660ebd))
* **projections:** remove redundant string interning ([#1411](https://github.com/Yo-DDV/Towk/issues/1411)) ([5e41dec](https://github.com/Yo-DDV/Towk/commit/5e41dece3a0bd3593ae592db23a79d70b6a03448))
* **realtime:** bound WebSocket compression memory ([#1400](https://github.com/Yo-DDV/Towk/issues/1400)) ([518eb0a](https://github.com/Yo-DDV/Towk/commit/518eb0a897a615a8c0aa52f32cee34d193861726))
* **realtime:** reduce per-connection memory ([#1389](https://github.com/Yo-DDV/Towk/issues/1389)) ([9ae1bb7](https://github.com/Yo-DDV/Towk/commit/9ae1bb73601309c9f1bd61523b6334cb0bc6c5d0))
* reduce room timeline projection retention ([#1016](https://github.com/Yo-DDV/Towk/issues/1016)) ([d77e2b5](https://github.com/Yo-DDV/Towk/commit/d77e2b5f1a0841e621da3ff90f899509299f53b5))
* replay projections through shared EVT fanout ([#1035](https://github.com/Yo-DDV/Towk/issues/1035)) ([7de1ebb](https://github.com/Yo-DDV/Towk/commit/7de1ebb1a1deb26d175d4dcf0a0954f07ec9ba31))
* share projection event consumers ([#1011](https://github.com/Yo-DDV/Towk/issues/1011)) ([e221d21](https://github.com/Yo-DDV/Towk/commit/e221d21d67d572abd491d43452e5896ead2b3d0f))


### Code Refactoring

* **api:** consolidate ConnectRPC surface ([#1306](https://github.com/Yo-DDV/Towk/issues/1306)) ([7d0b69a](https://github.com/Yo-DDV/Towk/commit/7d0b69ae3ca2632457b4333f861ed708d4bc8db1))
* **api:** consolidate public ConnectRPC API ([#1295](https://github.com/Yo-DDV/Towk/issues/1295)) ([dbf96a3](https://github.com/Yo-DDV/Towk/commit/dbf96a3453b7a49f31b7870fdbceb144540fd8b9))

## [0.5.0](https://github.com/Yo-DDV/Towk/releases/tag/v0.5.0) (2026-07-13)

Towk 0.5.0 is the first release from the independent
[Yo-DDV/Towk](https://github.com/Yo-DDV/Towk) repository. It starts from the
Chatto 0.4.7 codebase while preserving its Git history, notices, license
metadata, and compatibility identifiers. It is not a retroactive Towk release
of the inherited 0.4.x versions.

### Product foundation

- Establishes Towk as an independent, self-hosted communication workspace with
  its own repository, visual identity, PWA assets, documentation, issue intake,
  image registry, and release authority.
- Ships the application interface in English, German, French, Spanish, and
  Portuguese.
- Preserves the inherited `chatto.*` protocols, `CHATTO_*` environment
  variables, `chatto.toml`, storage schemas, and CLI binary compatibility to
  avoid an unsafe flag-day migration.
- Documents provenance, mixed-license boundaries, and a selective,
  review-before-import upstream synchronization policy.

### Security and reliability

- Updates vulnerable dependencies and resolves the actionable CodeQL findings.
- Hardens authentication, authorization capabilities, account deletion,
  passphrase handling, link previews, attachment validation, WebSocket quotas,
  backup/export atomicity, configuration creation, and encryption-key exports.
- Enforces the compatible browser CSP and HSTS defaults while documenting the
  remaining inline-policy and Trusted Types migration work.
- Restricts Docker Compose and Kubernetes examples, pins release inputs, and
  runs the public frontend and documentation images without root.
- Enables protected `main`, required CI/security checks, dependency review,
  secret scanning with push protection, SBOM generation, vulnerability scans,
  and build provenance attestations.

### Distribution

- Publishes multi-architecture Towk images through
  `ghcr.io/yo-ddv/towk`, tied to exact source commits and immutable digests.
- Produces Linux, macOS, Windows, and FreeBSD release archives with checksums,
  embedded legal notices, and provenance attestations.
- Keeps the software pre-1.0: pin an exact release or image digest for durable
  deployments.

### Compatibility

No intentional public API or persisted-event breaking change is introduced
relative to the documented Chatto 0.4.7 compatibility baseline. Towk-specific
branding and repository URLs change, while inherited technical identifiers stay
in place until a versioned, rollback-safe migration is designed.

## [0.4.7](https://github.com/chattocorp/chatto/compare/v0.4.6...v0.4.7) (2026-07-11)


### Bug Fixes

* **frontend:** show server logo before login ([#1416](https://github.com/chattocorp/chatto/issues/1416)) ([577cf17](https://github.com/chattocorp/chatto/commit/577cf179b0a1bb669813a619896c41fb81d24d17))
* **frontend:** stabilize linked-message navigation ([#1421](https://github.com/chattocorp/chatto/issues/1421)) ([721c974](https://github.com/chattocorp/chatto/commit/721c974bb0e02f62c654389588cdd34346f4fca9))
* **frontend:** support file drops in threads ([#1417](https://github.com/chattocorp/chatto/issues/1417)) ([6166dc0](https://github.com/chattocorp/chatto/commit/6166dc0a1537ea1c483a8c330b3ee515fc16235c))
* **release:** add next prerelease channel ([#1414](https://github.com/chattocorp/chatto/issues/1414)) ([6312e39](https://github.com/chattocorp/chatto/commit/6312e392fa1c0f16c74e5dce65166d586a1e76ca))


### Performance Improvements

* **frontend:** speed up large room member loading ([#1423](https://github.com/chattocorp/chatto/issues/1423)) ([6d4ce8a](https://github.com/chattocorp/chatto/commit/6d4ce8a5deaef0af8a34373ceae107359d01554a))

## [0.4.6](https://github.com/chattocorp/chatto/compare/v0.4.5...v0.4.6) (2026-07-11)


### Bug Fixes

* **api:** validate custom status emoji ([#1408](https://github.com/chattocorp/chatto/issues/1408)) ([cb62f72](https://github.com/chattocorp/chatto/commit/cb62f725eeab071b66d61b599eda0b74e154d573))


### Performance Improvements

* **projections:** bound replay idempotency memory ([#1407](https://github.com/chattocorp/chatto/issues/1407)) ([7dd3841](https://github.com/chattocorp/chatto/commit/7dd38411d8f6144f1a7126d13b23440348d09927))
* **projections:** remove redundant string interning ([#1411](https://github.com/chattocorp/chatto/issues/1411)) ([c69ef30](https://github.com/chattocorp/chatto/commit/c69ef30babce67e6b5ec8fe3d00a490bd626c545))

## [0.4.5](https://github.com/chattocorp/chatto/compare/v0.4.4...v0.4.5) (2026-07-11)


### Bug Fixes

* **assets:** recover physical deletion from events ([#1394](https://github.com/chattocorp/chatto/issues/1394)) ([e4d2a85](https://github.com/chattocorp/chatto/commit/e4d2a854ccf7549e423145c7ece0f926fd32d410))
* **core:** remove room leavers from voice calls ([#1373](https://github.com/chattocorp/chatto/issues/1373)) ([e0b1ad7](https://github.com/chattocorp/chatto/commit/e0b1ad7811eaaeaa3e7821268bbcdab8c73465b1))
* **docker:** support read-only root filesystems ([#1403](https://github.com/chattocorp/chatto/issues/1403)) ([76462a4](https://github.com/chattocorp/chatto/commit/76462a48b791c2f2b72ee2b2afe2c79ee13b5ef8))
* **docs:** correct deployment guide redirect ([#1395](https://github.com/chattocorp/chatto/issues/1395)) ([aded4e0](https://github.com/chattocorp/chatto/commit/aded4e093d32dbc94f6fc8046c58ff02aa501497))
* **frontend:** add optimistic room reads ([#1376](https://github.com/chattocorp/chatto/issues/1376)) ([22ffc62](https://github.com/chattocorp/chatto/commit/22ffc624a07f929b35a117690aef0c920b28294e))
* **frontend:** keep signed-out servers navigable ([#1397](https://github.com/chattocorp/chatto/issues/1397)) ([c3e281a](https://github.com/chattocorp/chatto/commit/c3e281a39be93639ced703a2943ddc4402c9bcfe))
* **frontend:** preserve optimistic reads across refresh ([#1393](https://github.com/chattocorp/chatto/issues/1393)) ([b77270d](https://github.com/chattocorp/chatto/commit/b77270d5912594220bd6fc470ae397a529f13b18))
* **frontend:** respect browser region in timestamps ([#1387](https://github.com/chattocorp/chatto/issues/1387)) ([7ca3b92](https://github.com/chattocorp/chatto/commit/7ca3b9284bc09de0723dff84cdd2a664162a8e29))
* **release:** restore Windows builds ([#1405](https://github.com/chattocorp/chatto/issues/1405)) ([f95a668](https://github.com/chattocorp/chatto/commit/f95a6680eb48bab7a382e1d95610c1bd6fde91e0))


### Performance Improvements

* **realtime:** bound WebSocket compression memory ([#1400](https://github.com/chattocorp/chatto/issues/1400)) ([c794e59](https://github.com/chattocorp/chatto/commit/c794e5925f81eca00b89fe9e06aaea98870b466c))
* **realtime:** reduce per-connection memory ([#1389](https://github.com/chattocorp/chatto/issues/1389)) ([963287d](https://github.com/chattocorp/chatto/commit/963287d6b16636e7919f8eecf3bd62e7e56759fa))

## [0.4.4](https://github.com/chattocorp/chatto/compare/v0.4.3...v0.4.4) (2026-07-10)


### Bug Fixes

* **api:** skip invalid followed-thread rooms ([#1366](https://github.com/chattocorp/chatto/issues/1366)) ([90a5918](https://github.com/chattocorp/chatto/commit/90a5918a8de8ce9bd857c34806a18e41f036fdf9))
* **docs:** add per-page social previews ([#1370](https://github.com/chattocorp/chatto/issues/1370)) ([69eab4a](https://github.com/chattocorp/chatto/commit/69eab4a3ff2a0299488299f549b198a973a8d8a9))
* **frontend:** allow any file in attachment picker ([#1364](https://github.com/chattocorp/chatto/issues/1364)) ([5b20e17](https://github.com/chattocorp/chatto/commit/5b20e176fca1248ccf118bd63c8dec5892a4512c))
* **frontend:** compress displayed images ([#1361](https://github.com/chattocorp/chatto/issues/1361)) ([5539816](https://github.com/chattocorp/chatto/commit/553981628cb0a0a40f27f2576abbf289f3f9c5b9))
* **messages:** expire context-free tombstones ([#1365](https://github.com/chattocorp/chatto/issues/1365)) ([98123b5](https://github.com/chattocorp/chatto/commit/98123b520c9a6242dd55bffb6594673192787d62))
* **notifications:** harden delivery and synchronization ([#1363](https://github.com/chattocorp/chatto/issues/1363)) ([b46e012](https://github.com/chattocorp/chatto/commit/b46e012075c7f14d664f60f1a05042e38c782243))
* **notifications:** prevent stale push delivery and badges ([#1368](https://github.com/chattocorp/chatto/issues/1368)) ([3c588aa](https://github.com/chattocorp/chatto/commit/3c588aa4d6cb53237be5519b1aa15fc85e094d1c))
* **pwa:** use server logo for install icons ([#1371](https://github.com/chattocorp/chatto/issues/1371)) ([49b26e9](https://github.com/chattocorp/chatto/commit/49b26e9c4f0efc269bcabbd091e63a630bf6913d))

## [0.4.3](https://github.com/chattocorp/chatto/compare/v0.4.2...v0.4.3) (2026-07-09)


### Bug Fixes

* **api:** tune room member page defaults ([#1354](https://github.com/chattocorp/chatto/issues/1354)) ([07675ee](https://github.com/chattocorp/chatto/commit/07675ee459af03edc184cd67171ebb9f7e105b63))
* backfill sparse room timelines ([#1353](https://github.com/chattocorp/chatto/issues/1353)) ([f8adf6a](https://github.com/chattocorp/chatto/commit/f8adf6a73b9a87510f1a17d0440c124472206686))
* **docs:** add community chat link ([#1344](https://github.com/chattocorp/chatto/issues/1344)) ([10c1eec](https://github.com/chattocorp/chatto/commit/10c1eec5fe03190f18b6ab45a5580a8a814d7ed6))
* **frontend:** add optimistic reactions ([#1349](https://github.com/chattocorp/chatto/issues/1349)) ([beaf180](https://github.com/chattocorp/chatto/commit/beaf180e79b6e1248879ec69e495568b24f18173))
* **frontend:** harden login redirect path validation ([#1340](https://github.com/chattocorp/chatto/issues/1340)) ([01db3e3](https://github.com/chattocorp/chatto/commit/01db3e3032950bf95793df64707ee655bcd9d99b))
* **frontend:** stabilize unread and resume refresh ([#1346](https://github.com/chattocorp/chatto/issues/1346)) ([d2f185a](https://github.com/chattocorp/chatto/commit/d2f185afca39be076ec6beda9493d1008319c53e))
* **frontend:** use opaque PWA install icons ([#1352](https://github.com/chattocorp/chatto/issues/1352)) ([afd025c](https://github.com/chattocorp/chatto/commit/afd025c2827a6b3914f6f6a737a340341fc3ea33))
* **metrics:** track realtime websocket connections ([#1356](https://github.com/chattocorp/chatto/issues/1356)) ([fd3ca58](https://github.com/chattocorp/chatto/commit/fd3ca582cee03cf4c3c9f753d1a14967fe0d6b1d))
* **pwa:** stop preserving push badge hints ([#1343](https://github.com/chattocorp/chatto/issues/1343)) ([d9e50a3](https://github.com/chattocorp/chatto/commit/d9e50a3912fff800b1ed71c3a42a91d3e85dbd52))
* **realtime:** align heartbeat cadence with client stall detection ([#1342](https://github.com/chattocorp/chatto/issues/1342)) ([c0e0d23](https://github.com/chattocorp/chatto/commit/c0e0d236ea4d29de7e75b63502323fe7be3ae967))

## [0.4.2](https://github.com/chattocorp/chatto/compare/v0.4.1...v0.4.2) (2026-07-07)


### Bug Fixes

* **api:** tolerate invalid presence user ids ([#1336](https://github.com/chattocorp/chatto/issues/1336)) ([76f1bef](https://github.com/chattocorp/chatto/commit/76f1befee805f7db0a5a2810f6f9fa160e273e35))
* **frontend:** render inline room join screen ([#1335](https://github.com/chattocorp/chatto/issues/1335)) ([af7c831](https://github.com/chattocorp/chatto/commit/af7c831d15c1b0d641ea0e367add127d629bdd92))
* **frontend:** separate input mode from viewport size ([#1339](https://github.com/chattocorp/chatto/issues/1339)) ([217da21](https://github.com/chattocorp/chatto/commit/217da2157820d2ce45e1912e0cbfec2b152c7fca))
* **frontend:** unify user card presence source ([#1334](https://github.com/chattocorp/chatto/issues/1334)) ([dde9b14](https://github.com/chattocorp/chatto/commit/dde9b1435bcbd31958de568e6bbf9a861a77f0d0))
* **push:** add declarative web push payloads ([#1338](https://github.com/chattocorp/chatto/issues/1338)) ([ede325d](https://github.com/chattocorp/chatto/commit/ede325dfdc1c29683fb0739bb7bade9659136eb0))

## [0.4.1](https://github.com/chattocorp/chatto/compare/v0.4.0...v0.4.1) (2026-07-07)


### Bug Fixes

* **api:** log internal connect errors ([#1329](https://github.com/chattocorp/chatto/issues/1329)) ([c292bac](https://github.com/chattocorp/chatto/commit/c292bac00bfefbb4ba0cdbc0f1686b1a377e380d))
* **frontend:** adopt menu shell for toasts ([#1323](https://github.com/chattocorp/chatto/issues/1323)) ([4982463](https://github.com/chattocorp/chatto/commit/4982463f6c396f7ae25ae83985f71453fb74a94d))
* **frontend:** align message footer row spacing ([#1331](https://github.com/chattocorp/chatto/issues/1331)) ([02841fe](https://github.com/chattocorp/chatto/commit/02841fe39c93b3821eaa32f37e67ea32de799577))
* **frontend:** hydrate room lifecycle event actors ([#1319](https://github.com/chattocorp/chatto/issues/1319)) ([a9abe8c](https://github.com/chattocorp/chatto/commit/a9abe8c03fd1e4e539d0870d56ca7569fbe4d2b5))
* **frontend:** improve chat link navigation ([#1333](https://github.com/chattocorp/chatto/issues/1333)) ([a88133f](https://github.com/chattocorp/chatto/commit/a88133fd05199ef23597f0b2258e2f1fb3dc06ec))
* **frontend:** improve reaction user popovers ([#1328](https://github.com/chattocorp/chatto/issues/1328)) ([2d1af04](https://github.com/chattocorp/chatto/commit/2d1af046e3fdc910762ea73bfb4ce78223865a9c))
* **frontend:** refresh recent emoji quick reactions ([#1327](https://github.com/chattocorp/chatto/issues/1327)) ([fab2ae4](https://github.com/chattocorp/chatto/commit/fab2ae44c5b57ca1a0dc8703e46eb244a27e2b83))
* **frontend:** simplify push notification click routing ([#1322](https://github.com/chattocorp/chatto/issues/1322)) ([21bff8d](https://github.com/chattocorp/chatto/commit/21bff8dac0996e087dbc0aeb4d23d21925b1fea2))
* **frontend:** simplify room resume catch-up ([#1332](https://github.com/chattocorp/chatto/issues/1332)) ([b7d32ce](https://github.com/chattocorp/chatto/commit/b7d32ce1c7756839f0f90d15d018f0c1023c0455))
* **frontend:** stabilize mobile sidebar gestures ([#1324](https://github.com/chattocorp/chatto/issues/1324)) ([1cbd3c5](https://github.com/chattocorp/chatto/commit/1cbd3c5f8b0adcc7b824c1023123c2498e81a225))
* **read-state:** reduce no-op read signals ([#1330](https://github.com/chattocorp/chatto/issues/1330)) ([244e4c8](https://github.com/chattocorp/chatto/commit/244e4c82851de9dc9ab9bc7a2b982e840840f631))
* **server:** reduce routine info logs ([#1325](https://github.com/chattocorp/chatto/issues/1325)) ([8849fd7](https://github.com/chattocorp/chatto/commit/8849fd7cd018b6a9112e920ef271b79fd0674629))

## [0.4.0](https://github.com/chattocorp/chatto/compare/v0.3.8...v0.4.0) (2026-07-06)


### ⚠ BREAKING CHANGES

* **api:** consolidate ConnectRPC surface ([#1306](https://github.com/chattocorp/chatto/issues/1306))
* **api:** clean up server assets calls and includes ([#1303](https://github.com/chattocorp/chatto/issues/1303))
* **api:** consolidate shared api shapes ([#1302](https://github.com/chattocorp/chatto/issues/1302))
* **api:** consolidate shared public API types ([#1299](https://github.com/chattocorp/chatto/issues/1299))
* **api:** consolidate public ConnectRPC API ([#1295](https://github.com/chattocorp/chatto/issues/1295))
* **api:** polish ConnectRPC API for 0.4.0 ([#1224](https://github.com/chattocorp/chatto/issues/1224))
* **operator:** add socket-backed operator user administration ([#1164](https://github.com/chattocorp/chatto/issues/1164))
* **api:** reshape server profile responses ([#1185](https://github.com/chattocorp/chatto/issues/1185))
* **api:** split ConnectRPC packages ([#1179](https://github.com/chattocorp/chatto/issues/1179))
* **api:** replace GraphQL with ConnectRPC ([#1166](https://github.com/chattocorp/chatto/issues/1166))
* **api:** use optional timeline presence fields ([#1110](https://github.com/chattocorp/chatto/issues/1110))

### Features

* add universal rooms ([#1046](https://github.com/chattocorp/chatto/issues/1046)) ([0b8c5cb](https://github.com/chattocorp/chatto/commit/0b8c5cb839876416a8262260ddc6a051ee0c94ba))
* **admin:** filter event log ([#1056](https://github.com/chattocorp/chatto/issues/1056)) ([d8bd280](https://github.com/chattocorp/chatto/commit/d8bd28076112e4e2a1488190cb29e9bf0acbc5cc))
* **api:** add ConnectRPC asset uploads ([#1249](https://github.com/chattocorp/chatto/issues/1249)) ([f97f1d0](https://github.com/chattocorp/chatto/commit/f97f1d097ba887279b228bcb0dd243cfd16f320b))
* **api:** add ConnectRPC DM start ([#1157](https://github.com/chattocorp/chatto/issues/1157)) ([c46ef79](https://github.com/chattocorp/chatto/commit/c46ef79ce782fad2f9cd26cb4db42fd7ae581a30))
* **api:** add ConnectRPC public API PoC ([#1067](https://github.com/chattocorp/chatto/issues/1067)) ([7aeb8f7](https://github.com/chattocorp/chatto/commit/7aeb8f7fd629da040d2e916600215fe3d02d0f26))
* **api:** add ConnectRPC reflection ([#1182](https://github.com/chattocorp/chatto/issues/1182)) ([a93324c](https://github.com/chattocorp/chatto/commit/a93324cf91e21cfab6eb7057f9b35e3545f3cf4c))
* **api:** add ConnectRPC room timeline PoC ([#1074](https://github.com/chattocorp/chatto/issues/1074)) ([920fcaa](https://github.com/chattocorp/chatto/commit/920fcaa26ca577ada529e2e1ef19d041d5baa47f))
* **api:** add protobuf realtime websocket ([#1158](https://github.com/chattocorp/chatto/issues/1158)) ([9e8e34c](https://github.com/chattocorp/chatto/commit/9e8e34cdc778be86007d0f6596468b445cfa4a0e))
* **api:** add resource batch reads ([#1232](https://github.com/chattocorp/chatto/issues/1232)) ([8a04ae0](https://github.com/chattocorp/chatto/commit/8a04ae0fa619efc180ff364098f986859f33e041))
* **api:** clean up ConnectRPC surface ([#1171](https://github.com/chattocorp/chatto/issues/1171)) ([03c42af](https://github.com/chattocorp/chatto/commit/03c42af51837bcd999bb3c34989ba706e2d291c5))
* **api:** clean up ConnectRPC surface ([#1178](https://github.com/chattocorp/chatto/issues/1178)) ([b1b6e28](https://github.com/chattocorp/chatto/commit/b1b6e28a818d3f878c0674bd741292d1e33f680e))
* **api:** clean up server assets calls and includes ([#1303](https://github.com/chattocorp/chatto/issues/1303)) ([e960def](https://github.com/chattocorp/chatto/commit/e960defc9c3a1cc77ae1958a8c98d9cc54919c25))
* **api:** consolidate membership services ([#1293](https://github.com/chattocorp/chatto/issues/1293)) ([7ed268c](https://github.com/chattocorp/chatto/commit/7ed268c71443c75201a1d26036f318f8df6f6e05))
* **api:** consolidate shared api shapes ([#1302](https://github.com/chattocorp/chatto/issues/1302)) ([4429009](https://github.com/chattocorp/chatto/commit/4429009ba3dd1b4ce0800b928c55fb8eaa308376))
* **api:** consolidate shared public API types ([#1299](https://github.com/chattocorp/chatto/issues/1299)) ([1ec2015](https://github.com/chattocorp/chatto/commit/1ec201551881142d8d5498902d0ff192e7b8bf7e))
* **api:** extract generated TypeScript clients ([#1183](https://github.com/chattocorp/chatto/issues/1183)) ([3480cda](https://github.com/chattocorp/chatto/commit/3480cdab949940d614160897134129693f14e782))
* **api:** extract TypeScript API client ([#1184](https://github.com/chattocorp/chatto/issues/1184)) ([b38b9a5](https://github.com/chattocorp/chatto/commit/b38b9a522cd48b5673109d09007b7d04709b251e))
* **api:** migrate reactions to ConnectRPC ([#1128](https://github.com/chattocorp/chatto/issues/1128)) ([161f51c](https://github.com/chattocorp/chatto/commit/161f51ccb4cc0cd3b1b098d1b5aa41c3f4405c8d))
* **api:** polish ConnectRPC API for 0.4.0 ([#1224](https://github.com/chattocorp/chatto/issues/1224)) ([06f4361](https://github.com/chattocorp/chatto/commit/06f4361d05e27587839e31b128e38b3ee011c743))
* **api:** port message posting to ConnectRPC ([#1093](https://github.com/chattocorp/chatto/issues/1093)) ([011018b](https://github.com/chattocorp/chatto/commit/011018bab165ba29e310f2e527a6dae9648899e2))
* **api:** port read state and thread follow to ConnectRPC ([#1087](https://github.com/chattocorp/chatto/issues/1087)) ([f2128d6](https://github.com/chattocorp/chatto/commit/f2128d60d6d1706217f06566102788900619e053))
* **api:** replace GraphQL with ConnectRPC ([#1166](https://github.com/chattocorp/chatto/issues/1166)) ([3dd3fa6](https://github.com/chattocorp/chatto/commit/3dd3fa686fc3c89912dcdf02475578389608f627))
* **api:** reshape server profile responses ([#1185](https://github.com/chattocorp/chatto/issues/1185)) ([96bde6e](https://github.com/chattocorp/chatto/commit/96bde6eb3d0ea9b134e7191e41b16fdc07d3bee1))
* **api:** split ConnectRPC packages ([#1179](https://github.com/chattocorp/chatto/issues/1179)) ([6ec286a](https://github.com/chattocorp/chatto/commit/6ec286a469377b5ebe338167cb0244bbc4a9b9d2))
* **api:** use optional timeline presence fields ([#1110](https://github.com/chattocorp/chatto/issues/1110)) ([5c1406f](https://github.com/chattocorp/chatto/commit/5c1406f0a28502be869964c87561c0e107c81446))
* **auth:** add SSO account creation and linking ([#1167](https://github.com/chattocorp/chatto/issues/1167)) ([61723e9](https://github.com/chattocorp/chatto/commit/61723e9e3e6c6f8802558c8a11acab31444c7efb))
* **auth:** type runtime credentials ([#1195](https://github.com/chattocorp/chatto/issues/1195)) ([5f0ebe4](https://github.com/chattocorp/chatto/commit/5f0ebe4264d4f4539ce85f4d8c3d1a6a779a9702))
* **config:** configure SMTP TLS verification ([#1159](https://github.com/chattocorp/chatto/issues/1159)) ([1f5c8b0](https://github.com/chattocorp/chatto/commit/1f5c8b09d2f4c13d0c13825c38e2bb5c4807beeb))
* **connectrpc:** add message management API ([#1146](https://github.com/chattocorp/chatto/issues/1146)) ([c07b049](https://github.com/chattocorp/chatto/commit/c07b0497ab09ae970895809edb5b31fd79c5e093))
* **connectrpc:** add room directory service ([#1138](https://github.com/chattocorp/chatto/issues/1138)) ([c1f13cf](https://github.com/chattocorp/chatto/commit/c1f13cfb4d0dc9cacb019c430db4f8494026ed02))
* **connectrpc:** add room lifecycle service ([#1134](https://github.com/chattocorp/chatto/issues/1134)) ([3f2b3a9](https://github.com/chattocorp/chatto/commit/3f2b3a922f97c4f99f20913e4e4d4a944bb79704))
* **connectrpc:** port thread history reads ([#1083](https://github.com/chattocorp/chatto/issues/1083)) ([4b81b4d](https://github.com/chattocorp/chatto/commit/4b81b4dbf78e879cdf2b10060f3777f6d2071dc3))
* **core:** persist link preview assets via storage backend ([#1060](https://github.com/chattocorp/chatto/issues/1060)) ([005deb1](https://github.com/chattocorp/chatto/commit/005deb1365f1899176cca57f91db8265cf7da009))
* **core:** store thread follows in EVT ([#1233](https://github.com/chattocorp/chatto/issues/1233)) ([01a2bb3](https://github.com/chattocorp/chatto/commit/01a2bb3d629b83dd30431afcb17e3746a4848d33))
* **dev:** add Mailpit to mise dev ([#1238](https://github.com/chattocorp/chatto/issues/1238)) ([0d07f7e](https://github.com/chattocorp/chatto/commit/0d07f7e8d9540de1d36cf56388f151bd94cb3f2b))
* **docs:** add release notes pages ([#1180](https://github.com/chattocorp/chatto/issues/1180)) ([6418471](https://github.com/chattocorp/chatto/commit/641847194e8d02cd86e8e9827b756a8cec109d56))
* **exporter:** add deployment-wide prometheus exporter ([#1059](https://github.com/chattocorp/chatto/issues/1059)) ([5aa29c7](https://github.com/chattocorp/chatto/commit/5aa29c747babe5b4dacc12a9a63eef57bcf36ec8))
* **frontend:** add multi-image attachment gallery ([#1241](https://github.com/chattocorp/chatto/issues/1241)) ([d8338c5](https://github.com/chattocorp/chatto/commit/d8338c517ef71069a08db44f402b949458ea6e92))
* **frontend:** add Paraglide-based client-shell i18n ([#1077](https://github.com/chattocorp/chatto/issues/1077)) ([1a4ab07](https://github.com/chattocorp/chatto/commit/1a4ab07211482af1236b3921607fd2deb8746f4f))
* **frontend:** add Trusted Types markdown policy ([#1307](https://github.com/chattocorp/chatto/issues/1307)) ([47b9060](https://github.com/chattocorp/chatto/commit/47b9060a0ba84df49464a564225a88914393d2e3))
* **frontend:** consolidate frontend design system ([#1053](https://github.com/chattocorp/chatto/issues/1053)) ([7fc39ab](https://github.com/chattocorp/chatto/commit/7fc39ab6aebdba74bd8eef56ba05323bf60ad901))
* **frontend:** improve admin member details ([#1057](https://github.com/chattocorp/chatto/issues/1057)) ([8c8ccce](https://github.com/chattocorp/chatto/commit/8c8cccee5335bf2d10948414a65b2d75a547c30f))
* **frontend:** maximize call pane ([#1240](https://github.com/chattocorp/chatto/issues/1240)) ([7aaa34a](https://github.com/chattocorp/chatto/commit/7aaa34ad4abb9d27cb558b10a8c8944a80240de7))
* **frontend:** move UI strings into i18n catalogs ([#1084](https://github.com/chattocorp/chatto/issues/1084)) ([d310382](https://github.com/chattocorp/chatto/commit/d310382e0795007da388e0514ac7d2056e961898))
* **frontend:** refresh admin system dashboard ([#1160](https://github.com/chattocorp/chatto/issues/1160)) ([5c54899](https://github.com/chattocorp/chatto/commit/5c54899f1eb676cff77ca3707b9e98eb36b639c6))
* **frontend:** refresh toast styling ([#1260](https://github.com/chattocorp/chatto/issues/1260)) ([1b728e5](https://github.com/chattocorp/chatto/commit/1b728e511e6b6310d10d59bf7c6085d4c70710d0))
* **frontend:** send typing indicators with ConnectRPC ([#1155](https://github.com/chattocorp/chatto/issues/1155)) ([1a131ee](https://github.com/chattocorp/chatto/commit/1a131eea08bb32a89462bbd0c010617cc2fdaedb))
* **frontend:** show call participants in room sidebar ([#1036](https://github.com/chattocorp/chatto/issues/1036)) ([8cd0858](https://github.com/chattocorp/chatto/commit/8cd085877d44633aa54578abf2d50a62942c0085))
* **frontend:** show reaction names in popups ([#1044](https://github.com/chattocorp/chatto/issues/1044)) ([e141b74](https://github.com/chattocorp/chatto/commit/e141b7441ca7d8d62252f2a9376ca3f2a768ea9d))
* **frontend:** show room descriptions in header ([#1037](https://github.com/chattocorp/chatto/issues/1037)) ([44f9c67](https://github.com/chattocorp/chatto/commit/44f9c67c979535584c12838ccc46eaf40a879d6c))
* **frontend:** use ConnectRPC for message writes ([#1153](https://github.com/chattocorp/chatto/issues/1153)) ([4b34f34](https://github.com/chattocorp/chatto/commit/4b34f341f4e96adb87d775c5ea2fc0ae04e12aee))
* **frontend:** use ConnectRPC for room commands ([#1150](https://github.com/chattocorp/chatto/issues/1150)) ([bfff68e](https://github.com/chattocorp/chatto/commit/bfff68e8d48a2adbd512be249e9482c467b03a88))
* **operator:** add socket-backed operator user administration ([#1164](https://github.com/chattocorp/chatto/issues/1164)) ([6209795](https://github.com/chattocorp/chatto/commit/6209795767fa38e2031bfb77e61b3bcb034a4b77))
* **presence:** add user-controlled presence modes ([#1095](https://github.com/chattocorp/chatto/issues/1095)) ([9e8f696](https://github.com/chattocorp/chatto/commit/9e8f696df7dc2489c639479f01eb7269ba13a922))
* **profile:** add custom user statuses ([#1081](https://github.com/chattocorp/chatto/issues/1081)) ([1d1d7d2](https://github.com/chattocorp/chatto/commit/1d1d7d214a28b9c9eb38c50522e44b943d7e5cb5))


### Bug Fixes

* **api:** address 0.4.0 surface review findings ([#1228](https://github.com/chattocorp/chatto/issues/1228)) ([bd054ff](https://github.com/chattocorp/chatto/commit/bd054ff0102c3065781064726c1d128f3980700e))
* **api:** align ConnectRPC permission exposure ([#1246](https://github.com/chattocorp/chatto/issues/1246)) ([cf2eca7](https://github.com/chattocorp/chatto/commit/cf2eca7877b10406f517e64f542fd56d1e73594e))
* **api:** centralize Connect room RBAC in core ([#1149](https://github.com/chattocorp/chatto/issues/1149)) ([8ba5b0c](https://github.com/chattocorp/chatto/commit/8ba5b0c2a3854f1ca7f18084a3225661a5e3d205))
* **api:** close ConnectRPC RBAC gaps ([#1207](https://github.com/chattocorp/chatto/issues/1207)) ([da0b129](https://github.com/chattocorp/chatto/commit/da0b1298db513bdc7a95319535039a01a04010e7))
* **api:** include user status in generated docs ([#1092](https://github.com/chattocorp/chatto/issues/1092)) ([52521fa](https://github.com/chattocorp/chatto/commit/52521fa5eeff94d9bebffabb010a6eb4b5e9de78))
* **api:** make ConnectRPC plumbing idiomatic ([#1123](https://github.com/chattocorp/chatto/issues/1123)) ([338f573](https://github.com/chattocorp/chatto/commit/338f57315cf611518ff4570434ee7faae1ccab7d))
* **api:** preserve offline presence in snapshots ([#1172](https://github.com/chattocorp/chatto/issues/1172)) ([7fce244](https://github.com/chattocorp/chatto/commit/7fce244d8f7deecd821966923ce2992c5a656f2c))
* **api:** tighten ConnectRPC caller auth ([#1126](https://github.com/chattocorp/chatto/issues/1126)) ([bb8c10d](https://github.com/chattocorp/chatto/commit/bb8c10df48a2c7e8a9a94164ee66d24d0517ac31))
* **assets:** prevent protected attachment caching ([#1261](https://github.com/chattocorp/chatto/issues/1261)) ([e3c6eed](https://github.com/chattocorp/chatto/commit/e3c6eedab25aa279ca1cae8e3ea2497fe391053d))
* **assets:** serve protected assets through stable gateway ([#1264](https://github.com/chattocorp/chatto/issues/1264)) ([744e93e](https://github.com/chattocorp/chatto/commit/744e93ed552e3920df9a76e0c3b6c9a90ebf6dcd))
* **attachments:** crop extreme image thumbnails ([#1181](https://github.com/chattocorp/chatto/issues/1181)) ([d5dd244](https://github.com/chattocorp/chatto/commit/d5dd244e42ea884cf4739523cda3479a17c1e4f8))
* **auth:** add structured unauthenticated GraphQL errors ([#1048](https://github.com/chattocorp/chatto/issues/1048)) ([510c07d](https://github.com/chattocorp/chatto/commit/510c07dd38ad3ccc9e87f515878c96594c72c9dd))
* **auth:** reject empty-user runtime credentials ([#1201](https://github.com/chattocorp/chatto/issues/1201)) ([43b569c](https://github.com/chattocorp/chatto/commit/43b569c348c89cdf6df1f49a6433b385625a2589))
* **calls:** preserve call on tab takeover ([#1284](https://github.com/chattocorp/chatto/issues/1284)) ([451929d](https://github.com/chattocorp/chatto/commit/451929d2bf2dbbcffbc879a5e98ceac2ab1153b1))
* **ci:** gate release-please on green ci ([#1135](https://github.com/chattocorp/chatto/issues/1135)) ([4decb0f](https://github.com/chattocorp/chatto/commit/4decb0f1362e876e461ce9436a6ce0f8cb340eab))
* **conductor:** use workspace port for Storybook ([#1290](https://github.com/chattocorp/chatto/issues/1290)) ([c5ba4dc](https://github.com/chattocorp/chatto/commit/c5ba4dc775c611e27c916cb46179a7d8264ac8f9))
* **connectapi:** harden message post migration ([#1097](https://github.com/chattocorp/chatto/issues/1097)) ([b15fb14](https://github.com/chattocorp/chatto/commit/b15fb14c2ee708915ab79255f6a86aab3c4cc764))
* **connectapi:** harden timeline and thread read handling ([#1117](https://github.com/chattocorp/chatto/issues/1117)) ([ba027fe](https://github.com/chattocorp/chatto/commit/ba027fe3b7727620307bc4936633effe8abd255d))
* **connectrpc:** cap request message size ([#1102](https://github.com/chattocorp/chatto/issues/1102)) ([a773531](https://github.com/chattocorp/chatto/commit/a773531e687de72645ee78b1aa09f07f9d61ef61))
* **connectrpc:** reject missing read anchors ([#1109](https://github.com/chattocorp/chatto/issues/1109)) ([f2f68b9](https://github.com/chattocorp/chatto/commit/f2f68b96fca00c177975600f1e9f38f2787a3c4b))
* **core:** complete service inventory metrics ([#1130](https://github.com/chattocorp/chatto/issues/1130)) ([9bc89f3](https://github.com/chattocorp/chatto/commit/9bc89f3e116df73330be22484b13a999419b12ed))
* **core:** prevent read marker regressions ([#1107](https://github.com/chattocorp/chatto/issues/1107)) ([cb81d58](https://github.com/chattocorp/chatto/commit/cb81d583f9c789319790109624af5ad8d112d680))
* **dockercompose:** enable LiveKit TURN relay ([#1190](https://github.com/chattocorp/chatto/issues/1190)) ([51eb5e7](https://github.com/chattocorp/chatto/commit/51eb5e799f4ebabb395c9f5073219d4015b2ac10))
* **docs:** keep release note cards in grid lanes ([#1204](https://github.com/chattocorp/chatto/issues/1204)) ([a6c79df](https://github.com/chattocorp/chatto/commit/a6c79df79793e9e3927a7d738b4f54ddbc1940f9))
* **frontend:** address svelte guidance review ([#1154](https://github.com/chattocorp/chatto/issues/1154)) ([d8c4010](https://github.com/chattocorp/chatto/commit/d8c4010b1b02ec4b65a15408b07f3800180a2a5e))
* **frontend:** align call control button colors ([#1085](https://github.com/chattocorp/chatto/issues/1085)) ([4b7f37e](https://github.com/chattocorp/chatto/commit/4b7f37e87d1bcfe8b388f59aa1ae70b7e3aff5ea))
* **frontend:** align muted call participant icon ([#1050](https://github.com/chattocorp/chatto/issues/1050)) ([68cea04](https://github.com/chattocorp/chatto/commit/68cea040f6129134b50cf1c745274e3f669b3746))
* **frontend:** clarify echo reply actions ([#1253](https://github.com/chattocorp/chatto/issues/1253)) ([5a2b264](https://github.com/chattocorp/chatto/commit/5a2b2645bd046c3e925bbb2c24c47eecbe534589))
* **frontend:** clarify iOS PWA push setup ([#1192](https://github.com/chattocorp/chatto/issues/1192)) ([2416a41](https://github.com/chattocorp/chatto/commit/2416a41f1cbf3cf31038b087c8cc207de8967c5e))
* **frontend:** clarify remote push notification support ([#1105](https://github.com/chattocorp/chatto/issues/1105)) ([bfdbdea](https://github.com/chattocorp/chatto/commit/bfdbdea4050d529ba060f5931009d74026a8631f))
* **frontend:** clear call-wide mode on notification navigation ([#1291](https://github.com/chattocorp/chatto/issues/1291)) ([db09a62](https://github.com/chattocorp/chatto/commit/db09a62949ffdbe56a7b1436a3a10df901b889bf))
* **frontend:** constrain current user card height ([#1239](https://github.com/chattocorp/chatto/issues/1239)) ([1b536b9](https://github.com/chattocorp/chatto/commit/1b536b96a7d0c7abb6baa152d82d348e0f6b0218))
* **frontend:** defer camera permission until enabled ([#1243](https://github.com/chattocorp/chatto/issues/1243)) ([2145a95](https://github.com/chattocorp/chatto/commit/2145a9535ada73b05a0938b5b6249c264eed99d1))
* **frontend:** defer unread separator until return to the room ([#1079](https://github.com/chattocorp/chatto/issues/1079)) ([9535694](https://github.com/chattocorp/chatto/commit/95356945a66376560017888ef0291295f6d13f1e))
* **frontend:** handle API auth failures gracefully ([#1269](https://github.com/chattocorp/chatto/issues/1269)) ([e82c554](https://github.com/chattocorp/chatto/commit/e82c5543328b6999ec65b4ede625cd28b17b89b9))
* **frontend:** harden asset proxy token handling ([#1054](https://github.com/chattocorp/chatto/issues/1054)) ([8797c65](https://github.com/chattocorp/chatto/commit/8797c65aa35b304ac5e77216f783f404865d2928))
* **frontend:** ignore stale DM member loads when switching rooms ([#1065](https://github.com/chattocorp/chatto/issues/1065)) ([b4264b7](https://github.com/chattocorp/chatto/commit/b4264b77c12b4492b0391597072e20a1809b0316))
* **frontend:** improve call presence indicators ([#1257](https://github.com/chattocorp/chatto/issues/1257)) ([696a92e](https://github.com/chattocorp/chatto/commit/696a92e008919c2358c188a23963bc9d489fc166))
* **frontend:** improve extreme image thumbnails ([#1227](https://github.com/chattocorp/chatto/issues/1227)) ([d5c596d](https://github.com/chattocorp/chatto/commit/d5c596d56bb306e4503c36d1883900b284d7b5c7))
* **frontend:** improve LiveKit media error handling ([#1281](https://github.com/chattocorp/chatto/issues/1281)) ([94a86c0](https://github.com/chattocorp/chatto/commit/94a86c0e9ed789f7e05175186b7ecfdd999af1bf))
* **frontend:** improve unread channel contrast ([#1089](https://github.com/chattocorp/chatto/issues/1089)) ([74247b4](https://github.com/chattocorp/chatto/commit/74247b42833d07c33a2950dc357cf5c4b06a3f66))
* **frontend:** localize date formatting ([#1242](https://github.com/chattocorp/chatto/issues/1242)) ([cfc96ec](https://github.com/chattocorp/chatto/commit/cfc96ec847220f580249031d25f5db80dbd89ecf))
* **frontend:** make attachment remove control subtle ([#1265](https://github.com/chattocorp/chatto/issues/1265)) ([6537c27](https://github.com/chattocorp/chatto/commit/6537c2768136e633fdea9d36226ab9fb350b8875))
* **frontend:** make scrollbars follow selected theme ([#1152](https://github.com/chattocorp/chatto/issues/1152)) ([9c5fa16](https://github.com/chattocorp/chatto/commit/9c5fa16da9555d38c0331e5876d4b35b025d4371))
* **frontend:** polish error and missing media states ([#1267](https://github.com/chattocorp/chatto/issues/1267)) ([b9dabba](https://github.com/chattocorp/chatto/commit/b9dabba0f018656fb46418868ed65e3774bea627))
* **frontend:** preserve touch composer line breaks ([#1194](https://github.com/chattocorp/chatto/issues/1194)) ([8c62c70](https://github.com/chattocorp/chatto/commit/8c62c700f1a4a07369cb17ba0dd2ea9141bcdf8d))
* **frontend:** quiet console warning noise ([#1280](https://github.com/chattocorp/chatto/issues/1280)) ([4df7b85](https://github.com/chattocorp/chatto/commit/4df7b8575f1bf489d6f0518e31367dfb8729af7a))
* **frontend:** reconcile notification badge dismissals ([#1058](https://github.com/chattocorp/chatto/issues/1058)) ([13c7a6e](https://github.com/chattocorp/chatto/commit/13c7a6ef51a34f6a99964fcbe167f30fd8e7d304))
* **frontend:** reconcile PWA notification badges ([#1229](https://github.com/chattocorp/chatto/issues/1229)) ([e44645e](https://github.com/chattocorp/chatto/commit/e44645e271cf099eec2e19f9030b10891f76f937))
* **frontend:** refresh messages after local deletions ([#1148](https://github.com/chattocorp/chatto/issues/1148)) ([cefc22a](https://github.com/chattocorp/chatto/commit/cefc22a77efee0f333b848a054c0a56078b0a0d6))
* **frontend:** remove redundant universal room badge ([#1052](https://github.com/chattocorp/chatto/issues/1052)) ([5f6131e](https://github.com/chattocorp/chatto/commit/5f6131ee3fe98e5713a2eb64e2da22f5d5287e68))
* **frontend:** reset inline code state when composer clears ([#1251](https://github.com/chattocorp/chatto/issues/1251)) ([0dddeaa](https://github.com/chattocorp/chatto/commit/0dddeaa24e62d028797a93f3cd808e94a1141485))
* **frontend:** restore circular avatars with stable presence dots ([#1252](https://github.com/chattocorp/chatto/issues/1252)) ([14b15b9](https://github.com/chattocorp/chatto/commit/14b15b93382c9b9719b068e889691b5f44f6cf2f))
* **frontend:** restore default text smoothing ([#1268](https://github.com/chattocorp/chatto/issues/1268)) ([b3a6dc3](https://github.com/chattocorp/chatto/commit/b3a6dc3c2796181995338649e4a2a7502e56761b))
* **frontend:** restrict same-tab message links ([#1068](https://github.com/chattocorp/chatto/issues/1068)) ([d43d23f](https://github.com/chattocorp/chatto/commit/d43d23f70da28a324743673f585085c70f5d89ac))
* **frontend:** restyle reply attribution preview ([#1140](https://github.com/chattocorp/chatto/issues/1140)) ([909c1f4](https://github.com/chattocorp/chatto/commit/909c1f4a2d67ba2979be765b9eaecff611e96e90))
* **frontend:** share unread marker lifecycle with threads ([#1310](https://github.com/chattocorp/chatto/issues/1310)) ([07c3601](https://github.com/chattocorp/chatto/commit/07c36016132af7dd34441f6e032240f6e03bf721))
* **frontend:** show loading state for call media toggles ([#1237](https://github.com/chattocorp/chatto/issues/1237)) ([9063832](https://github.com/chattocorp/chatto/commit/9063832ae074a47852f340b38fa15d755c8399a6))
* **frontend:** stabilize new messages separator ([#1308](https://github.com/chattocorp/chatto/issues/1308)) ([c35ed86](https://github.com/chattocorp/chatto/commit/c35ed8641c9910bf86c71e38563a42868e3cc2a4))
* **frontend:** stabilize tab resume catch-up ([#1288](https://github.com/chattocorp/chatto/issues/1288)) ([b70916d](https://github.com/chattocorp/chatto/commit/b70916d877c231dba9ab67fbfc2983df4d774aa2))
* **frontend:** style room member search clear button ([#1226](https://github.com/chattocorp/chatto/issues/1226)) ([e43f615](https://github.com/chattocorp/chatto/commit/e43f615e951b12200f1994e844d3b82de4ecdeca))
* **frontend:** submit simple message edits with enter ([#1129](https://github.com/chattocorp/chatto/issues/1129)) ([f5651b4](https://github.com/chattocorp/chatto/commit/f5651b4413b70aaa954d3bdb7c553df21e7c42ca))
* **frontend:** sync presence badge across tabs ([#1301](https://github.com/chattocorp/chatto/issues/1301)) ([5fbfb22](https://github.com/chattocorp/chatto/commit/5fbfb22d715f6a315f61a0c9f3a063879842468b))
* **frontend:** sync room thread follow bell state ([#1121](https://github.com/chattocorp/chatto/issues/1121)) ([4048f23](https://github.com/chattocorp/chatto/commit/4048f23256f87e417509fb887d2919c59bad5a38))
* **frontend:** use direct ticketed asset URLs ([#1312](https://github.com/chattocorp/chatto/issues/1312)) ([b41eb1d](https://github.com/chattocorp/chatto/commit/b41eb1d8d3d062f794c680a892bed15a5d451ca3))
* **frontend:** use full-width image galleries ([#1247](https://github.com/chattocorp/chatto/issues/1247)) ([f5fe88a](https://github.com/chattocorp/chatto/commit/f5fe88aff3fdfc9cc676dd8735dfd850fc3a7cb3))
* **frontend:** use semantic presence colors ([#1259](https://github.com/chattocorp/chatto/issues/1259)) ([ccf64db](https://github.com/chattocorp/chatto/commit/ccf64db80552887782a357b3bb23acdba7f12b0c))
* **frontend:** wire UI strings to i18n ([#1225](https://github.com/chattocorp/chatto/issues/1225)) ([7eafcd3](https://github.com/chattocorp/chatto/commit/7eafcd34507e6a86e4983ac2ab29c25ee0e6cb95))
* **media:** preserve video aspect ratios ([#1254](https://github.com/chattocorp/chatto/issues/1254)) ([8a85f0a](https://github.com/chattocorp/chatto/commit/8a85f0a434e688fe2a7b25a096c010ee74ebd274))
* **messages:** validate reply targets before posting ([#1176](https://github.com/chattocorp/chatto/issues/1176)) ([2919a1a](https://github.com/chattocorp/chatto/commit/2919a1a4fcb0cf5b13a6e22764329bee0f9f1d1d))
* **notifications:** clear read notifications server-side ([#1297](https://github.com/chattocorp/chatto/issues/1297)) ([c6f3c30](https://github.com/chattocorp/chatto/commit/c6f3c30d1729f48bebf47047963262acd32a1d4e))
* **notifications:** preserve unread badge state across dismissals ([#1069](https://github.com/chattocorp/chatto/issues/1069)) ([03444e3](https://github.com/chattocorp/chatto/commit/03444e39cf171bb87277d6db20fd20d422378a3d))
* **pwa:** reduce service worker reload churn ([#1187](https://github.com/chattocorp/chatto/issues/1187)) ([5489e47](https://github.com/chattocorp/chatto/commit/5489e4742cf577f50295dc8f29d30ed64841245b))
* **reactions:** canonicalize echo reaction targets ([#1272](https://github.com/chattocorp/chatto/issues/1272)) ([2b87044](https://github.com/chattocorp/chatto/commit/2b8704479e08eb66ebefc86243cd3f8aa98d338b))
* **release:** publish release before updating tap ([#1298](https://github.com/chattocorp/chatto/issues/1298)) ([c5c8aa6](https://github.com/chattocorp/chatto/commit/c5c8aa64b255b423a2b01c074f1e7155a2a7f3ef))
* **voice:** scope LiveKit observations to active calls ([#1049](https://github.com/chattocorp/chatto/issues/1049)) ([dcd95c8](https://github.com/chattocorp/chatto/commit/dcd95c8cdd9f964e36eeea73592d2827dcb83c9e))


### Performance Improvements

* **build:** improve frontend and CLI cache reuse ([#1106](https://github.com/chattocorp/chatto/issues/1106)) ([f22da3a](https://github.com/chattocorp/chatto/commit/f22da3adcd5a8affe8b15715cd02569baddad2e7))
* **core:** cache unwrapped DEKs per request ([#1193](https://github.com/chattocorp/chatto/issues/1193)) ([0623831](https://github.com/chattocorp/chatto/commit/0623831519d7e4839caa77f18fe0a7702e604305))
* **core:** slim timeline projection memory ([#1287](https://github.com/chattocorp/chatto/issues/1287)) ([cd026ff](https://github.com/chattocorp/chatto/commit/cd026ff14dab59b45d9bf26b78bcdca08b81edc8))
* **frontend:** load room members in larger batches ([#1206](https://github.com/chattocorp/chatto/issues/1206)) ([f465a09](https://github.com/chattocorp/chatto/commit/f465a095e88819c6f210f36b1bc334e3c4e06c5a))
* **frontend:** split chat code from app chrome ([#1103](https://github.com/chattocorp/chatto/issues/1103)) ([4a4a4de](https://github.com/chattocorp/chatto/commit/4a4a4de0747e73d37183bc3fde89f6d0f45c8890))


### Code Refactoring

* **api:** consolidate ConnectRPC surface ([#1306](https://github.com/chattocorp/chatto/issues/1306)) ([900233d](https://github.com/chattocorp/chatto/commit/900233da483c64de8aa6f7fd2d6d7a6d6f2cc16b))
* **api:** consolidate public ConnectRPC API ([#1295](https://github.com/chattocorp/chatto/issues/1295)) ([a0ab823](https://github.com/chattocorp/chatto/commit/a0ab82321db80f44569fd55019726b8e4c458ddb))

## [0.4.0-beta.14](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.13...v0.4.0-beta.14) (2026-07-05)


### ⚠ BREAKING CHANGES

* **api:** consolidate ConnectRPC surface ([#1306](https://github.com/chattocorp/chatto/issues/1306))
* **api:** clean up server assets calls and includes ([#1303](https://github.com/chattocorp/chatto/issues/1303))
* **api:** consolidate shared api shapes ([#1302](https://github.com/chattocorp/chatto/issues/1302))
* **api:** consolidate shared public API types ([#1299](https://github.com/chattocorp/chatto/issues/1299))

### Features

* **api:** clean up server assets calls and includes ([#1303](https://github.com/chattocorp/chatto/issues/1303)) ([e960def](https://github.com/chattocorp/chatto/commit/e960defc9c3a1cc77ae1958a8c98d9cc54919c25))
* **api:** consolidate shared api shapes ([#1302](https://github.com/chattocorp/chatto/issues/1302)) ([4429009](https://github.com/chattocorp/chatto/commit/4429009ba3dd1b4ce0800b928c55fb8eaa308376))
* **api:** consolidate shared public API types ([#1299](https://github.com/chattocorp/chatto/issues/1299)) ([1ec2015](https://github.com/chattocorp/chatto/commit/1ec201551881142d8d5498902d0ff192e7b8bf7e))


### Bug Fixes

* **frontend:** sync presence badge across tabs ([#1301](https://github.com/chattocorp/chatto/issues/1301)) ([5fbfb22](https://github.com/chattocorp/chatto/commit/5fbfb22d715f6a315f61a0c9f3a063879842468b))
* **release:** publish release before updating tap ([#1298](https://github.com/chattocorp/chatto/issues/1298)) ([c5c8aa6](https://github.com/chattocorp/chatto/commit/c5c8aa64b255b423a2b01c074f1e7155a2a7f3ef))


### Code Refactoring

* **api:** consolidate ConnectRPC surface ([#1306](https://github.com/chattocorp/chatto/issues/1306)) ([900233d](https://github.com/chattocorp/chatto/commit/900233da483c64de8aa6f7fd2d6d7a6d6f2cc16b))

## [0.4.0-beta.13](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.12...v0.4.0-beta.13) (2026-07-04)


### ⚠ BREAKING CHANGES

* **api:** consolidate public ConnectRPC API ([#1295](https://github.com/chattocorp/chatto/issues/1295))

### Features

* **api:** consolidate membership services ([#1293](https://github.com/chattocorp/chatto/issues/1293)) ([7ed268c](https://github.com/chattocorp/chatto/commit/7ed268c71443c75201a1d26036f318f8df6f6e05))


### Bug Fixes

* **calls:** preserve call on tab takeover ([#1284](https://github.com/chattocorp/chatto/issues/1284)) ([451929d](https://github.com/chattocorp/chatto/commit/451929d2bf2dbbcffbc879a5e98ceac2ab1153b1))
* **conductor:** use workspace port for Storybook ([#1290](https://github.com/chattocorp/chatto/issues/1290)) ([c5ba4dc](https://github.com/chattocorp/chatto/commit/c5ba4dc775c611e27c916cb46179a7d8264ac8f9))
* **frontend:** clear call-wide mode on notification navigation ([#1291](https://github.com/chattocorp/chatto/issues/1291)) ([db09a62](https://github.com/chattocorp/chatto/commit/db09a62949ffdbe56a7b1436a3a10df901b889bf))
* **frontend:** improve LiveKit media error handling ([#1281](https://github.com/chattocorp/chatto/issues/1281)) ([94a86c0](https://github.com/chattocorp/chatto/commit/94a86c0e9ed789f7e05175186b7ecfdd999af1bf))
* **frontend:** quiet console warning noise ([#1280](https://github.com/chattocorp/chatto/issues/1280)) ([4df7b85](https://github.com/chattocorp/chatto/commit/4df7b8575f1bf489d6f0518e31367dfb8729af7a))
* **frontend:** stabilize tab resume catch-up ([#1288](https://github.com/chattocorp/chatto/issues/1288)) ([b70916d](https://github.com/chattocorp/chatto/commit/b70916d877c231dba9ab67fbfc2983df4d774aa2))
* **notifications:** clear read notifications server-side ([#1297](https://github.com/chattocorp/chatto/issues/1297)) ([c6f3c30](https://github.com/chattocorp/chatto/commit/c6f3c30d1729f48bebf47047963262acd32a1d4e))


### Performance Improvements

* **core:** slim timeline projection memory ([#1287](https://github.com/chattocorp/chatto/issues/1287)) ([cd026ff](https://github.com/chattocorp/chatto/commit/cd026ff14dab59b45d9bf26b78bcdca08b81edc8))


### Code Refactoring

* **api:** consolidate public ConnectRPC API ([#1295](https://github.com/chattocorp/chatto/issues/1295)) ([a0ab823](https://github.com/chattocorp/chatto/commit/a0ab82321db80f44569fd55019726b8e4c458ddb))

## [0.4.0-beta.12](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.11...v0.4.0-beta.12) (2026-07-03)


### Features

* **frontend:** refresh toast styling ([#1260](https://github.com/chattocorp/chatto/issues/1260)) ([1b728e5](https://github.com/chattocorp/chatto/commit/1b728e511e6b6310d10d59bf7c6085d4c70710d0))


### Bug Fixes

* **assets:** prevent protected attachment caching ([#1261](https://github.com/chattocorp/chatto/issues/1261)) ([e3c6eed](https://github.com/chattocorp/chatto/commit/e3c6eedab25aa279ca1cae8e3ea2497fe391053d))
* **assets:** serve protected assets through stable gateway ([#1264](https://github.com/chattocorp/chatto/issues/1264)) ([744e93e](https://github.com/chattocorp/chatto/commit/744e93ed552e3920df9a76e0c3b6c9a90ebf6dcd))
* **frontend:** handle API auth failures gracefully ([#1269](https://github.com/chattocorp/chatto/issues/1269)) ([e82c554](https://github.com/chattocorp/chatto/commit/e82c5543328b6999ec65b4ede625cd28b17b89b9))
* **frontend:** make attachment remove control subtle ([#1265](https://github.com/chattocorp/chatto/issues/1265)) ([6537c27](https://github.com/chattocorp/chatto/commit/6537c2768136e633fdea9d36226ab9fb350b8875))
* **frontend:** polish error and missing media states ([#1267](https://github.com/chattocorp/chatto/issues/1267)) ([b9dabba](https://github.com/chattocorp/chatto/commit/b9dabba0f018656fb46418868ed65e3774bea627))
* **frontend:** restore default text smoothing ([#1268](https://github.com/chattocorp/chatto/issues/1268)) ([b3a6dc3](https://github.com/chattocorp/chatto/commit/b3a6dc3c2796181995338649e4a2a7502e56761b))
* **frontend:** use semantic presence colors ([#1259](https://github.com/chattocorp/chatto/issues/1259)) ([ccf64db](https://github.com/chattocorp/chatto/commit/ccf64db80552887782a357b3bb23acdba7f12b0c))
* **reactions:** canonicalize echo reaction targets ([#1272](https://github.com/chattocorp/chatto/issues/1272)) ([2b87044](https://github.com/chattocorp/chatto/commit/2b8704479e08eb66ebefc86243cd3f8aa98d338b))

## [0.4.0-beta.11](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.10...v0.4.0-beta.11) (2026-07-02)


### Features

* **api:** add ConnectRPC asset uploads ([#1249](https://github.com/chattocorp/chatto/issues/1249)) ([f97f1d0](https://github.com/chattocorp/chatto/commit/f97f1d097ba887279b228bcb0dd243cfd16f320b))


### Bug Fixes

* **api:** align ConnectRPC permission exposure ([#1246](https://github.com/chattocorp/chatto/issues/1246)) ([cf2eca7](https://github.com/chattocorp/chatto/commit/cf2eca7877b10406f517e64f542fd56d1e73594e))
* **frontend:** clarify echo reply actions ([#1253](https://github.com/chattocorp/chatto/issues/1253)) ([5a2b264](https://github.com/chattocorp/chatto/commit/5a2b2645bd046c3e925bbb2c24c47eecbe534589))
* **frontend:** improve call presence indicators ([#1257](https://github.com/chattocorp/chatto/issues/1257)) ([696a92e](https://github.com/chattocorp/chatto/commit/696a92e008919c2358c188a23963bc9d489fc166))
* **frontend:** reset inline code state when composer clears ([#1251](https://github.com/chattocorp/chatto/issues/1251)) ([0dddeaa](https://github.com/chattocorp/chatto/commit/0dddeaa24e62d028797a93f3cd808e94a1141485))
* **frontend:** restore circular avatars with stable presence dots ([#1252](https://github.com/chattocorp/chatto/issues/1252)) ([14b15b9](https://github.com/chattocorp/chatto/commit/14b15b93382c9b9719b068e889691b5f44f6cf2f))
* **frontend:** use full-width image galleries ([#1247](https://github.com/chattocorp/chatto/issues/1247)) ([f5fe88a](https://github.com/chattocorp/chatto/commit/f5fe88aff3fdfc9cc676dd8735dfd850fc3a7cb3))
* **media:** preserve video aspect ratios ([#1254](https://github.com/chattocorp/chatto/issues/1254)) ([8a85f0a](https://github.com/chattocorp/chatto/commit/8a85f0a434e688fe2a7b25a096c010ee74ebd274))

## [0.4.0-beta.10](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.9...v0.4.0-beta.10) (2026-07-02)


### ⚠ BREAKING CHANGES

* **api:** polish ConnectRPC API for 0.4.0 ([#1224](https://github.com/chattocorp/chatto/issues/1224))

### Features

* **api:** add resource batch reads ([#1232](https://github.com/chattocorp/chatto/issues/1232)) ([8a04ae0](https://github.com/chattocorp/chatto/commit/8a04ae0fa619efc180ff364098f986859f33e041))
* **api:** polish ConnectRPC API for 0.4.0 ([#1224](https://github.com/chattocorp/chatto/issues/1224)) ([06f4361](https://github.com/chattocorp/chatto/commit/06f4361d05e27587839e31b128e38b3ee011c743))
* **core:** store thread follows in EVT ([#1233](https://github.com/chattocorp/chatto/issues/1233)) ([01a2bb3](https://github.com/chattocorp/chatto/commit/01a2bb3d629b83dd30431afcb17e3746a4848d33))
* **dev:** add Mailpit to mise dev ([#1238](https://github.com/chattocorp/chatto/issues/1238)) ([0d07f7e](https://github.com/chattocorp/chatto/commit/0d07f7e8d9540de1d36cf56388f151bd94cb3f2b))
* **frontend:** add multi-image attachment gallery ([#1241](https://github.com/chattocorp/chatto/issues/1241)) ([d8338c5](https://github.com/chattocorp/chatto/commit/d8338c517ef71069a08db44f402b949458ea6e92))
* **frontend:** maximize call pane ([#1240](https://github.com/chattocorp/chatto/issues/1240)) ([7aaa34a](https://github.com/chattocorp/chatto/commit/7aaa34ad4abb9d27cb558b10a8c8944a80240de7))


### Bug Fixes

* **api:** address 0.4.0 surface review findings ([#1228](https://github.com/chattocorp/chatto/issues/1228)) ([bd054ff](https://github.com/chattocorp/chatto/commit/bd054ff0102c3065781064726c1d128f3980700e))
* **api:** close ConnectRPC RBAC gaps ([#1207](https://github.com/chattocorp/chatto/issues/1207)) ([da0b129](https://github.com/chattocorp/chatto/commit/da0b1298db513bdc7a95319535039a01a04010e7))
* **docs:** keep release note cards in grid lanes ([#1204](https://github.com/chattocorp/chatto/issues/1204)) ([a6c79df](https://github.com/chattocorp/chatto/commit/a6c79df79793e9e3927a7d738b4f54ddbc1940f9))
* **frontend:** constrain current user card height ([#1239](https://github.com/chattocorp/chatto/issues/1239)) ([1b536b9](https://github.com/chattocorp/chatto/commit/1b536b96a7d0c7abb6baa152d82d348e0f6b0218))
* **frontend:** defer camera permission until enabled ([#1243](https://github.com/chattocorp/chatto/issues/1243)) ([2145a95](https://github.com/chattocorp/chatto/commit/2145a9535ada73b05a0938b5b6249c264eed99d1))
* **frontend:** improve extreme image thumbnails ([#1227](https://github.com/chattocorp/chatto/issues/1227)) ([d5c596d](https://github.com/chattocorp/chatto/commit/d5c596d56bb306e4503c36d1883900b284d7b5c7))
* **frontend:** localize date formatting ([#1242](https://github.com/chattocorp/chatto/issues/1242)) ([cfc96ec](https://github.com/chattocorp/chatto/commit/cfc96ec847220f580249031d25f5db80dbd89ecf))
* **frontend:** reconcile PWA notification badges ([#1229](https://github.com/chattocorp/chatto/issues/1229)) ([e44645e](https://github.com/chattocorp/chatto/commit/e44645e271cf099eec2e19f9030b10891f76f937))
* **frontend:** show loading state for call media toggles ([#1237](https://github.com/chattocorp/chatto/issues/1237)) ([9063832](https://github.com/chattocorp/chatto/commit/9063832ae074a47852f340b38fa15d755c8399a6))
* **frontend:** style room member search clear button ([#1226](https://github.com/chattocorp/chatto/issues/1226)) ([e43f615](https://github.com/chattocorp/chatto/commit/e43f615e951b12200f1994e844d3b82de4ecdeca))
* **frontend:** wire UI strings to i18n ([#1225](https://github.com/chattocorp/chatto/issues/1225)) ([7eafcd3](https://github.com/chattocorp/chatto/commit/7eafcd34507e6a86e4983ac2ab29c25ee0e6cb95))


### Performance Improvements

* **frontend:** load room members in larger batches ([#1206](https://github.com/chattocorp/chatto/issues/1206)) ([f465a09](https://github.com/chattocorp/chatto/commit/f465a095e88819c6f210f36b1bc334e3c4e06c5a))

## [0.4.0-beta.9](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.8...v0.4.0-beta.9) (2026-06-30)


### Bug Fixes

* **auth:** reject empty-user runtime credentials ([#1201](https://github.com/chattocorp/chatto/issues/1201)) ([43b569c](https://github.com/chattocorp/chatto/commit/43b569c348c89cdf6df1f49a6433b385625a2589))

## [0.4.0-beta.8](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.7...v0.4.0-beta.8) (2026-06-30)


### Features

* **auth:** type runtime credentials ([#1195](https://github.com/chattocorp/chatto/issues/1195)) ([5f0ebe4](https://github.com/chattocorp/chatto/commit/5f0ebe4264d4f4539ce85f4d8c3d1a6a779a9702))


### Bug Fixes

* **frontend:** preserve touch composer line breaks ([#1194](https://github.com/chattocorp/chatto/issues/1194)) ([8c62c70](https://github.com/chattocorp/chatto/commit/8c62c700f1a4a07369cb17ba0dd2ea9141bcdf8d))

## [0.4.0-beta.7](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.6...v0.4.0-beta.7) (2026-06-30)


### ⚠ BREAKING CHANGES

* **operator:** add socket-backed operator user administration ([#1164](https://github.com/chattocorp/chatto/issues/1164))

### Features

* **auth:** add SSO account creation and linking ([#1167](https://github.com/chattocorp/chatto/issues/1167)) ([61723e9](https://github.com/chattocorp/chatto/commit/61723e9e3e6c6f8802558c8a11acab31444c7efb))
* **operator:** add socket-backed operator user administration ([#1164](https://github.com/chattocorp/chatto/issues/1164)) ([6209795](https://github.com/chattocorp/chatto/commit/6209795767fa38e2031bfb77e61b3bcb034a4b77))


### Bug Fixes

* **dockercompose:** enable LiveKit TURN relay ([#1190](https://github.com/chattocorp/chatto/issues/1190)) ([51eb5e7](https://github.com/chattocorp/chatto/commit/51eb5e799f4ebabb395c9f5073219d4015b2ac10))
* **pwa:** reduce service worker reload churn ([#1187](https://github.com/chattocorp/chatto/issues/1187)) ([5489e47](https://github.com/chattocorp/chatto/commit/5489e4742cf577f50295dc8f29d30ed64841245b))

## [0.4.0-beta.6](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.5...v0.4.0-beta.6) (2026-06-29)


### ⚠ BREAKING CHANGES

* **api:** reshape server profile responses ([#1185](https://github.com/chattocorp/chatto/issues/1185))

### Features

* **api:** reshape server profile responses ([#1185](https://github.com/chattocorp/chatto/issues/1185)) ([96bde6e](https://github.com/chattocorp/chatto/commit/96bde6eb3d0ea9b134e7191e41b16fdc07d3bee1))

## [0.4.0-beta.5](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.4...v0.4.0-beta.5) (2026-06-29)


### ⚠ BREAKING CHANGES

* **api:** split ConnectRPC packages ([#1179](https://github.com/chattocorp/chatto/issues/1179))

### Features

* **api:** add ConnectRPC reflection ([#1182](https://github.com/chattocorp/chatto/issues/1182)) ([a93324c](https://github.com/chattocorp/chatto/commit/a93324cf91e21cfab6eb7057f9b35e3545f3cf4c))
* **api:** clean up ConnectRPC surface ([#1171](https://github.com/chattocorp/chatto/issues/1171)) ([03c42af](https://github.com/chattocorp/chatto/commit/03c42af51837bcd999bb3c34989ba706e2d291c5))
* **api:** clean up ConnectRPC surface ([#1178](https://github.com/chattocorp/chatto/issues/1178)) ([b1b6e28](https://github.com/chattocorp/chatto/commit/b1b6e28a818d3f878c0674bd741292d1e33f680e))
* **api:** extract generated TypeScript clients ([#1183](https://github.com/chattocorp/chatto/issues/1183)) ([3480cda](https://github.com/chattocorp/chatto/commit/3480cdab949940d614160897134129693f14e782))
* **api:** extract TypeScript API client ([#1184](https://github.com/chattocorp/chatto/issues/1184)) ([b38b9a5](https://github.com/chattocorp/chatto/commit/b38b9a522cd48b5673109d09007b7d04709b251e))
* **api:** split ConnectRPC packages ([#1179](https://github.com/chattocorp/chatto/issues/1179)) ([6ec286a](https://github.com/chattocorp/chatto/commit/6ec286a469377b5ebe338167cb0244bbc4a9b9d2))
* **docs:** add release notes pages ([#1180](https://github.com/chattocorp/chatto/issues/1180)) ([6418471](https://github.com/chattocorp/chatto/commit/641847194e8d02cd86e8e9827b756a8cec109d56))


### Bug Fixes

* **api:** preserve offline presence in snapshots ([#1172](https://github.com/chattocorp/chatto/issues/1172)) ([7fce244](https://github.com/chattocorp/chatto/commit/7fce244d8f7deecd821966923ce2992c5a656f2c))
* **attachments:** crop extreme image thumbnails ([#1181](https://github.com/chattocorp/chatto/issues/1181)) ([d5dd244](https://github.com/chattocorp/chatto/commit/d5dd244e42ea884cf4739523cda3479a17c1e4f8))
* **messages:** validate reply targets before posting ([#1176](https://github.com/chattocorp/chatto/issues/1176)) ([2919a1a](https://github.com/chattocorp/chatto/commit/2919a1a4fcb0cf5b13a6e22764329bee0f9f1d1d))

## [0.4.0-beta.4](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.3...v0.4.0-beta.4) (2026-06-28)


### ⚠ BREAKING CHANGES

* **api:** replace GraphQL with ConnectRPC ([#1166](https://github.com/chattocorp/chatto/issues/1166))

### Features

* **api:** add ConnectRPC DM start ([#1157](https://github.com/chattocorp/chatto/issues/1157)) ([c46ef79](https://github.com/chattocorp/chatto/commit/c46ef79ce782fad2f9cd26cb4db42fd7ae581a30))
* **api:** add protobuf realtime websocket ([#1158](https://github.com/chattocorp/chatto/issues/1158)) ([9e8e34c](https://github.com/chattocorp/chatto/commit/9e8e34cdc778be86007d0f6596468b445cfa4a0e))
* **api:** replace GraphQL with ConnectRPC ([#1166](https://github.com/chattocorp/chatto/issues/1166)) ([3dd3fa6](https://github.com/chattocorp/chatto/commit/3dd3fa686fc3c89912dcdf02475578389608f627))
* **config:** configure SMTP TLS verification ([#1159](https://github.com/chattocorp/chatto/issues/1159)) ([1f5c8b0](https://github.com/chattocorp/chatto/commit/1f5c8b09d2f4c13d0c13825c38e2bb5c4807beeb))
* **connectrpc:** add message management API ([#1146](https://github.com/chattocorp/chatto/issues/1146)) ([c07b049](https://github.com/chattocorp/chatto/commit/c07b0497ab09ae970895809edb5b31fd79c5e093))
* **connectrpc:** add room directory service ([#1138](https://github.com/chattocorp/chatto/issues/1138)) ([c1f13cf](https://github.com/chattocorp/chatto/commit/c1f13cfb4d0dc9cacb019c430db4f8494026ed02))
* **connectrpc:** add room lifecycle service ([#1134](https://github.com/chattocorp/chatto/issues/1134)) ([3f2b3a9](https://github.com/chattocorp/chatto/commit/3f2b3a922f97c4f99f20913e4e4d4a944bb79704))
* **frontend:** refresh admin system dashboard ([#1160](https://github.com/chattocorp/chatto/issues/1160)) ([5c54899](https://github.com/chattocorp/chatto/commit/5c54899f1eb676cff77ca3707b9e98eb36b639c6))
* **frontend:** send typing indicators with ConnectRPC ([#1155](https://github.com/chattocorp/chatto/issues/1155)) ([1a131ee](https://github.com/chattocorp/chatto/commit/1a131eea08bb32a89462bbd0c010617cc2fdaedb))
* **frontend:** use ConnectRPC for message writes ([#1153](https://github.com/chattocorp/chatto/issues/1153)) ([4b34f34](https://github.com/chattocorp/chatto/commit/4b34f341f4e96adb87d775c5ea2fc0ae04e12aee))
* **frontend:** use ConnectRPC for room commands ([#1150](https://github.com/chattocorp/chatto/issues/1150)) ([bfff68e](https://github.com/chattocorp/chatto/commit/bfff68e8d48a2adbd512be249e9482c467b03a88))


### Bug Fixes

* **api:** centralize Connect room RBAC in core ([#1149](https://github.com/chattocorp/chatto/issues/1149)) ([8ba5b0c](https://github.com/chattocorp/chatto/commit/8ba5b0c2a3854f1ca7f18084a3225661a5e3d205))
* **ci:** gate release-please on green ci ([#1135](https://github.com/chattocorp/chatto/issues/1135)) ([4decb0f](https://github.com/chattocorp/chatto/commit/4decb0f1362e876e461ce9436a6ce0f8cb340eab))
* **frontend:** address svelte guidance review ([#1154](https://github.com/chattocorp/chatto/issues/1154)) ([d8c4010](https://github.com/chattocorp/chatto/commit/d8c4010b1b02ec4b65a15408b07f3800180a2a5e))
* **frontend:** make scrollbars follow selected theme ([#1152](https://github.com/chattocorp/chatto/issues/1152)) ([9c5fa16](https://github.com/chattocorp/chatto/commit/9c5fa16da9555d38c0331e5876d4b35b025d4371))
* **frontend:** refresh messages after local deletions ([#1148](https://github.com/chattocorp/chatto/issues/1148)) ([cefc22a](https://github.com/chattocorp/chatto/commit/cefc22a77efee0f333b848a054c0a56078b0a0d6))
* **frontend:** restyle reply attribution preview ([#1140](https://github.com/chattocorp/chatto/issues/1140)) ([909c1f4](https://github.com/chattocorp/chatto/commit/909c1f4a2d67ba2979be765b9eaecff611e96e90))

## [0.4.0-beta.3](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.2...v0.4.0-beta.3) (2026-06-25)


### ⚠ BREAKING CHANGES

* **api:** use optional timeline presence fields ([#1110](https://github.com/chattocorp/chatto/issues/1110))

### Features

* **api:** migrate reactions to ConnectRPC ([#1128](https://github.com/chattocorp/chatto/issues/1128)) ([161f51c](https://github.com/chattocorp/chatto/commit/161f51ccb4cc0cd3b1b098d1b5aa41c3f4405c8d))
* **api:** use optional timeline presence fields ([#1110](https://github.com/chattocorp/chatto/issues/1110)) ([5c1406f](https://github.com/chattocorp/chatto/commit/5c1406f0a28502be869964c87561c0e107c81446))
* **presence:** add user-controlled presence modes ([#1095](https://github.com/chattocorp/chatto/issues/1095)) ([9e8f696](https://github.com/chattocorp/chatto/commit/9e8f696df7dc2489c639479f01eb7269ba13a922))


### Bug Fixes

* **api:** make ConnectRPC plumbing idiomatic ([#1123](https://github.com/chattocorp/chatto/issues/1123)) ([338f573](https://github.com/chattocorp/chatto/commit/338f57315cf611518ff4570434ee7faae1ccab7d))
* **api:** tighten ConnectRPC caller auth ([#1126](https://github.com/chattocorp/chatto/issues/1126)) ([bb8c10d](https://github.com/chattocorp/chatto/commit/bb8c10df48a2c7e8a9a94164ee66d24d0517ac31))
* **connectapi:** harden timeline and thread read handling ([#1117](https://github.com/chattocorp/chatto/issues/1117)) ([ba027fe](https://github.com/chattocorp/chatto/commit/ba027fe3b7727620307bc4936633effe8abd255d))
* **connectrpc:** cap request message size ([#1102](https://github.com/chattocorp/chatto/issues/1102)) ([a773531](https://github.com/chattocorp/chatto/commit/a773531e687de72645ee78b1aa09f07f9d61ef61))
* **connectrpc:** reject missing read anchors ([#1109](https://github.com/chattocorp/chatto/issues/1109)) ([f2f68b9](https://github.com/chattocorp/chatto/commit/f2f68b96fca00c177975600f1e9f38f2787a3c4b))
* **core:** complete service inventory metrics ([#1130](https://github.com/chattocorp/chatto/issues/1130)) ([9bc89f3](https://github.com/chattocorp/chatto/commit/9bc89f3e116df73330be22484b13a999419b12ed))
* **core:** prevent read marker regressions ([#1107](https://github.com/chattocorp/chatto/issues/1107)) ([cb81d58](https://github.com/chattocorp/chatto/commit/cb81d583f9c789319790109624af5ad8d112d680))
* **frontend:** clarify remote push notification support ([#1105](https://github.com/chattocorp/chatto/issues/1105)) ([bfdbdea](https://github.com/chattocorp/chatto/commit/bfdbdea4050d529ba060f5931009d74026a8631f))
* **frontend:** submit simple message edits with enter ([#1129](https://github.com/chattocorp/chatto/issues/1129)) ([f5651b4](https://github.com/chattocorp/chatto/commit/f5651b4413b70aaa954d3bdb7c553df21e7c42ca))
* **frontend:** sync room thread follow bell state ([#1121](https://github.com/chattocorp/chatto/issues/1121)) ([4048f23](https://github.com/chattocorp/chatto/commit/4048f23256f87e417509fb887d2919c59bad5a38))


### Performance Improvements

* **build:** improve frontend and CLI cache reuse ([#1106](https://github.com/chattocorp/chatto/issues/1106)) ([f22da3a](https://github.com/chattocorp/chatto/commit/f22da3adcd5a8affe8b15715cd02569baddad2e7))
* **frontend:** split chat code from app chrome ([#1103](https://github.com/chattocorp/chatto/issues/1103)) ([4a4a4de](https://github.com/chattocorp/chatto/commit/4a4a4de0747e73d37183bc3fde89f6d0f45c8890))

## [0.4.0-beta.2](https://github.com/chattocorp/chatto/compare/v0.4.0-beta.1...v0.4.0-beta.2) (2026-06-24)


### Features

* **api:** port message posting to ConnectRPC ([#1093](https://github.com/chattocorp/chatto/issues/1093)) ([011018b](https://github.com/chattocorp/chatto/commit/011018bab165ba29e310f2e527a6dae9648899e2))
* **api:** port read state and thread follow to ConnectRPC ([#1087](https://github.com/chattocorp/chatto/issues/1087)) ([f2128d6](https://github.com/chattocorp/chatto/commit/f2128d60d6d1706217f06566102788900619e053))
* **connectrpc:** port thread history reads ([#1083](https://github.com/chattocorp/chatto/issues/1083)) ([4b81b4d](https://github.com/chattocorp/chatto/commit/4b81b4dbf78e879cdf2b10060f3777f6d2071dc3))
* **frontend:** add Paraglide-based client-shell i18n ([#1077](https://github.com/chattocorp/chatto/issues/1077)) ([1a4ab07](https://github.com/chattocorp/chatto/commit/1a4ab07211482af1236b3921607fd2deb8746f4f))
* **frontend:** move UI strings into i18n catalogs ([#1084](https://github.com/chattocorp/chatto/issues/1084)) ([d310382](https://github.com/chattocorp/chatto/commit/d310382e0795007da388e0514ac7d2056e961898))
* **profile:** add custom user statuses ([#1081](https://github.com/chattocorp/chatto/issues/1081)) ([1d1d7d2](https://github.com/chattocorp/chatto/commit/1d1d7d214a28b9c9eb38c50522e44b943d7e5cb5))


### Bug Fixes

* **api:** include user status in generated docs ([#1092](https://github.com/chattocorp/chatto/issues/1092)) ([52521fa](https://github.com/chattocorp/chatto/commit/52521fa5eeff94d9bebffabb010a6eb4b5e9de78))
* **connectapi:** harden message post migration ([#1097](https://github.com/chattocorp/chatto/issues/1097)) ([b15fb14](https://github.com/chattocorp/chatto/commit/b15fb14c2ee708915ab79255f6a86aab3c4cc764))
* **frontend:** align call control button colors ([#1085](https://github.com/chattocorp/chatto/issues/1085)) ([4b7f37e](https://github.com/chattocorp/chatto/commit/4b7f37e87d1bcfe8b388f59aa1ae70b7e3aff5ea))
* **frontend:** defer unread separator until return to the room ([#1079](https://github.com/chattocorp/chatto/issues/1079)) ([9535694](https://github.com/chattocorp/chatto/commit/95356945a66376560017888ef0291295f6d13f1e))
* **frontend:** improve unread channel contrast ([#1089](https://github.com/chattocorp/chatto/issues/1089)) ([74247b4](https://github.com/chattocorp/chatto/commit/74247b42833d07c33a2950dc357cf5c4b06a3f66))

## [0.4.0-beta.1](https://github.com/chattocorp/chatto/compare/v0.3.8...v0.4.0-beta.1) (2026-06-23)


### Features

* add universal rooms ([#1046](https://github.com/chattocorp/chatto/issues/1046)) ([0b8c5cb](https://github.com/chattocorp/chatto/commit/0b8c5cb839876416a8262260ddc6a051ee0c94ba))
* **admin:** filter event log ([#1056](https://github.com/chattocorp/chatto/issues/1056)) ([d8bd280](https://github.com/chattocorp/chatto/commit/d8bd28076112e4e2a1488190cb29e9bf0acbc5cc))
* **api:** add ConnectRPC public API PoC ([#1067](https://github.com/chattocorp/chatto/issues/1067)) ([7aeb8f7](https://github.com/chattocorp/chatto/commit/7aeb8f7fd629da040d2e916600215fe3d02d0f26))
* **api:** add ConnectRPC room timeline PoC ([#1074](https://github.com/chattocorp/chatto/issues/1074)) ([920fcaa](https://github.com/chattocorp/chatto/commit/920fcaa26ca577ada529e2e1ef19d041d5baa47f))
* **core:** persist link preview assets via storage backend ([#1060](https://github.com/chattocorp/chatto/issues/1060)) ([005deb1](https://github.com/chattocorp/chatto/commit/005deb1365f1899176cca57f91db8265cf7da009))
* **exporter:** add deployment-wide prometheus exporter ([#1059](https://github.com/chattocorp/chatto/issues/1059)) ([5aa29c7](https://github.com/chattocorp/chatto/commit/5aa29c747babe5b4dacc12a9a63eef57bcf36ec8))
* **frontend:** consolidate frontend design system ([#1053](https://github.com/chattocorp/chatto/issues/1053)) ([7fc39ab](https://github.com/chattocorp/chatto/commit/7fc39ab6aebdba74bd8eef56ba05323bf60ad901))
* **frontend:** improve admin member details ([#1057](https://github.com/chattocorp/chatto/issues/1057)) ([8c8ccce](https://github.com/chattocorp/chatto/commit/8c8cccee5335bf2d10948414a65b2d75a547c30f))
* **frontend:** show call participants in room sidebar ([#1036](https://github.com/chattocorp/chatto/issues/1036)) ([8cd0858](https://github.com/chattocorp/chatto/commit/8cd085877d44633aa54578abf2d50a62942c0085))
* **frontend:** show reaction names in popups ([#1044](https://github.com/chattocorp/chatto/issues/1044)) ([e141b74](https://github.com/chattocorp/chatto/commit/e141b7441ca7d8d62252f2a9376ca3f2a768ea9d))
* **frontend:** show room descriptions in header ([#1037](https://github.com/chattocorp/chatto/issues/1037)) ([44f9c67](https://github.com/chattocorp/chatto/commit/44f9c67c979535584c12838ccc46eaf40a879d6c))


### Bug Fixes

* **auth:** add structured unauthenticated GraphQL errors ([#1048](https://github.com/chattocorp/chatto/issues/1048)) ([510c07d](https://github.com/chattocorp/chatto/commit/510c07dd38ad3ccc9e87f515878c96594c72c9dd))
* **frontend:** align muted call participant icon ([#1050](https://github.com/chattocorp/chatto/issues/1050)) ([68cea04](https://github.com/chattocorp/chatto/commit/68cea040f6129134b50cf1c745274e3f669b3746))
* **frontend:** harden asset proxy token handling ([#1054](https://github.com/chattocorp/chatto/issues/1054)) ([8797c65](https://github.com/chattocorp/chatto/commit/8797c65aa35b304ac5e77216f783f404865d2928))
* **frontend:** ignore stale DM member loads when switching rooms ([#1065](https://github.com/chattocorp/chatto/issues/1065)) ([b4264b7](https://github.com/chattocorp/chatto/commit/b4264b77c12b4492b0391597072e20a1809b0316))
* **frontend:** reconcile notification badge dismissals ([#1058](https://github.com/chattocorp/chatto/issues/1058)) ([13c7a6e](https://github.com/chattocorp/chatto/commit/13c7a6ef51a34f6a99964fcbe167f30fd8e7d304))
* **frontend:** remove redundant universal room badge ([#1052](https://github.com/chattocorp/chatto/issues/1052)) ([5f6131e](https://github.com/chattocorp/chatto/commit/5f6131ee3fe98e5713a2eb64e2da22f5d5287e68))
* **frontend:** restrict same-tab message links ([#1068](https://github.com/chattocorp/chatto/issues/1068)) ([d43d23f](https://github.com/chattocorp/chatto/commit/d43d23f70da28a324743673f585085c70f5d89ac))
* **notifications:** preserve unread badge state across dismissals ([#1069](https://github.com/chattocorp/chatto/issues/1069)) ([03444e3](https://github.com/chattocorp/chatto/commit/03444e39cf171bb87277d6db20fd20d422378a3d))
* **voice:** scope LiveKit observations to active calls ([#1049](https://github.com/chattocorp/chatto/issues/1049)) ([dcd95c8](https://github.com/chattocorp/chatto/commit/dcd95c8cdd9f964e36eeea73592d2827dcb83c9e))

## [0.3.8](https://github.com/chattocorp/chatto/compare/v0.3.7...v0.3.8) (2026-06-20)


### Bug Fixes

* downgrade invalid session cookie logs ([#1029](https://github.com/chattocorp/chatto/issues/1029)) ([5bbbe88](https://github.com/chattocorp/chatto/commit/5bbbe88a5f34f885266c8afcf66cff6762adc6ca))
* improve push notification routing ([#1031](https://github.com/chattocorp/chatto/issues/1031)) ([bda7d3d](https://github.com/chattocorp/chatto/commit/bda7d3da31a1e02158fa3cc6646ff4c1d6cb59f8))
* **sidebar:** server-local sidebar links now open in the same window ([#1041](https://github.com/chattocorp/chatto/issues/1041)) ([b206d56](https://github.com/chattocorp/chatto/commit/b206d56dfde6ecfd9f3e82a32134c8685245a2f4))


### Performance Improvements

* add opt-in profiling diagnostics ([#1038](https://github.com/chattocorp/chatto/issues/1038)) ([ca2a2f6](https://github.com/chattocorp/chatto/commit/ca2a2f69efe049e85dc3e18c8c9d2f1a92cd6ad3))
* fast-path projection stream sequence parsing ([#1042](https://github.com/chattocorp/chatto/issues/1042)) ([ad28708](https://github.com/chattocorp/chatto/commit/ad28708ea90a0e8eb4b69bbb3faf51abf7ee41a5))
* optimize projection dispatch matching ([#1040](https://github.com/chattocorp/chatto/issues/1040)) ([8f40573](https://github.com/chattocorp/chatto/commit/8f40573bf1d3b7107be3d99ca61c51738f9c1afd))
* optimize projection replay and memory ([#1032](https://github.com/chattocorp/chatto/issues/1032)) ([f0118ed](https://github.com/chattocorp/chatto/commit/f0118eda47250f1df50a744ab3fb4e9f5774497d))
* replay projections through shared EVT fanout ([#1035](https://github.com/chattocorp/chatto/issues/1035)) ([15d322d](https://github.com/chattocorp/chatto/commit/15d322db9ab01012129f75911b98e6a83cac0815))

## [0.3.7](https://github.com/chattocorp/chatto/compare/v0.3.6...v0.3.7) (2026-06-19)


### Bug Fixes

* remove graphql error logging ([#1026](https://github.com/chattocorp/chatto/issues/1026)) ([bb3071c](https://github.com/chattocorp/chatto/commit/bb3071c3eb2acc63fb4e7c1fc655824e9fce0878))

## [0.3.6](https://github.com/chattocorp/chatto/compare/v0.3.5...v0.3.6) (2026-06-19)


### Performance Improvements

* reduce room timeline projection retention ([#1016](https://github.com/chattocorp/chatto/issues/1016)) ([dd779b7](https://github.com/chattocorp/chatto/commit/dd779b7752fea58c0383fe81cec60a6689a8da35))

## [0.3.5](https://github.com/chattocorp/chatto/compare/v0.3.4...v0.3.5) (2026-06-19)


### Features

* add LiveKit screen sharing ([#1021](https://github.com/chattocorp/chatto/issues/1021)) ([068abda](https://github.com/chattocorp/chatto/commit/068abda7cf55df077ac0d7a78b6912c2bba9fc63))
* **frontend:** add call join leave sound cues ([#1023](https://github.com/chattocorp/chatto/issues/1023)) ([1cf9e85](https://github.com/chattocorp/chatto/commit/1cf9e850bc8b48cc46ae6eea36be416940e16e6c))
* **frontend:** add display theme preference ([#1018](https://github.com/chattocorp/chatto/issues/1018)) ([ed7e276](https://github.com/chattocorp/chatto/commit/ed7e2767e5284144cdaa0ee923a1ca7f91af5f43))


### Bug Fixes

* **calls:** improve LiveKit join resilience ([#1022](https://github.com/chattocorp/chatto/issues/1022)) ([e9a0e55](https://github.com/chattocorp/chatto/commit/e9a0e55dcbfa75c783d174530de6771bf98f5313))
* **frontend:** make thread badges native links ([#1020](https://github.com/chattocorp/chatto/issues/1020)) ([e8c3642](https://github.com/chattocorp/chatto/commit/e8c364242624a9412aef63c0e93508bb9ed2074b))
* hide call lifecycle events from room history ([#1017](https://github.com/chattocorp/chatto/issues/1017)) ([5315770](https://github.com/chattocorp/chatto/commit/53157702aba589e58f5e5580214187f636ed0dff))

## [0.3.4](https://github.com/chattocorp/chatto/compare/v0.3.3...v0.3.4) (2026-06-19)


### Features

* add scoped server sign-out ([#1006](https://github.com/chattocorp/chatto/issues/1006)) ([1fc081b](https://github.com/chattocorp/chatto/commit/1fc081b0189b5d60313fbe496a93166b68cbaa06))
* **frontend:** refresh call sidebar UI ([#1001](https://github.com/chattocorp/chatto/issues/1001)) ([cd48c1a](https://github.com/chattocorp/chatto/commit/cd48c1aa8dcf6357d939a4442923bc443284dfb4))


### Bug Fixes

* **frontend:** clear stale mention autocomplete state ([#1015](https://github.com/chattocorp/chatto/issues/1015)) ([9132ab6](https://github.com/chattocorp/chatto/commit/9132ab68f5a5fd69b7c4ea16e47dc3f8e5396cf6))
* **frontend:** eagerly load room members ([#1009](https://github.com/chattocorp/chatto/issues/1009)) ([d76ae9a](https://github.com/chattocorp/chatto/commit/d76ae9ae4d1f66aeef60fb07687a1a0aafd73535))
* **frontend:** prevent room badge clipping ([#1012](https://github.com/chattocorp/chatto/issues/1012)) ([5c86be7](https://github.com/chattocorp/chatto/commit/5c86be751a41d2ec6eca69f3eba6ffc4b7579c99))
* reconcile in-app notification badges ([#1008](https://github.com/chattocorp/chatto/issues/1008)) ([be8cb02](https://github.com/chattocorp/chatto/commit/be8cb02fa6045470940a4a58532858c41e19c633))


### Performance Improvements

* share projection event consumers ([#1011](https://github.com/chattocorp/chatto/issues/1011)) ([31e08fc](https://github.com/chattocorp/chatto/commit/31e08fc4f76a324e0518d94ebf9cf06c36979821))

## [0.3.3](https://github.com/chattocorp/chatto/compare/v0.3.2...v0.3.3) (2026-06-19)


### Performance Improvements

* optimize projection startup paths ([#1005](https://github.com/chattocorp/chatto/issues/1005)) ([b69f2ef](https://github.com/chattocorp/chatto/commit/b69f2ef93c3263a2021a75b71e2d131de28ab2ac))

## [0.3.2](https://github.com/chattocorp/chatto/compare/v0.3.1...v0.3.2) (2026-06-19)


### Features

* monitor projection startup duration ([#1004](https://github.com/chattocorp/chatto/issues/1004)) ([3c6083c](https://github.com/chattocorp/chatto/commit/3c6083ca095ea8a3ce6dd86850f97ec3014b64d7))


### Bug Fixes

* **frontend:** preserve nested reply quotes ([#1000](https://github.com/chattocorp/chatto/issues/1000)) ([5f97896](https://github.com/chattocorp/chatto/commit/5f978963d1d203c210c3c8d4002da3dd86130560))
* **graphql:** enforce room move group permissions ([#987](https://github.com/chattocorp/chatto/issues/987)) ([1364b7b](https://github.com/chattocorp/chatto/commit/1364b7b4752a5b13a26752027d19d8cdae4a9764))

## [0.3.1](https://github.com/chattocorp/chatto/compare/v0.3.0...v0.3.1) (2026-06-18)


### Features

* quote selected text when replying ([#978](https://github.com/chattocorp/chatto/issues/978)) ([4844e89](https://github.com/chattocorp/chatto/commit/4844e89d62c3ca569960c3817236abe4d29699ce))


### Bug Fixes

* correct push notification deep links ([#982](https://github.com/chattocorp/chatto/issues/982)) ([d6bfe9f](https://github.com/chattocorp/chatto/commit/d6bfe9fa9cff5d9522ef9120a5a452bbb93248f6))
* **frontend:** add embed frame vertical spacing ([#976](https://github.com/chattocorp/chatto/issues/976)) ([4137f7f](https://github.com/chattocorp/chatto/commit/4137f7fa4d6310032363e4c75e6659b7babedbac))
* **frontend:** echo local room posts after send ([#980](https://github.com/chattocorp/chatto/issues/980)) ([33f0f46](https://github.com/chattocorp/chatto/commit/33f0f46135318ee916c8acda68d6c0debf8af53f))
* **frontend:** remove server name from room header ([#979](https://github.com/chattocorp/chatto/issues/979)) ([5e58bd5](https://github.com/chattocorp/chatto/commit/5e58bd5ee07d7c3a882feaeb8ba7eefab4e6931f))
* **frontend:** tighten mobile message action sheet ([#981](https://github.com/chattocorp/chatto/issues/981)) ([e30a153](https://github.com/chattocorp/chatto/commit/e30a15301181f5387b917af9bd6dd94e5246a0ce))

## [0.3.0](https://github.com/chattocorp/chatto/compare/v0.2.3...v0.3.0) (2026-06-18)


### ⚠ BREAKING CHANGES

* **sidebar:** list rooms visible via room.list ([#961](https://github.com/chattocorp/chatto/issues/961))

### Features

* add simple and rich composer modes ([#974](https://github.com/chattocorp/chatto/issues/974)) ([ec5bcea](https://github.com/chattocorp/chatto/commit/ec5bceaaba4f87c162366ed1a98b95b622041f95))
* gate message attachments with message.attach ([#966](https://github.com/chattocorp/chatto/issues/966)) ([2870f0f](https://github.com/chattocorp/chatto/commit/2870f0faa0b12c0d8b618a7bacaf4f2a8fce2e49))
* improve linked message previews ([#970](https://github.com/chattocorp/chatto/issues/970)) ([aecdb1b](https://github.com/chattocorp/chatto/commit/aecdb1b3b1762b44ac21e9a62fab0d1a462a2b99))
* improve room member loading and search ([#963](https://github.com/chattocorp/chatto/issues/963)) ([33bd45a](https://github.com/chattocorp/chatto/commit/33bd45a75949fa2c448d3c8625f375c855233e7f))
* **messages:** add copy link menu action ([#969](https://github.com/chattocorp/chatto/issues/969)) ([2afdee2](https://github.com/chattocorp/chatto/commit/2afdee20780d30aee9a6c8018c4f77e6f3d388dd))
* **sidebar:** list rooms visible via room.list ([#961](https://github.com/chattocorp/chatto/issues/961)) ([fe27c06](https://github.com/chattocorp/chatto/commit/fe27c068a834762f79c61e6a480907345ba89b58))
* simplify web push opt-in ([#971](https://github.com/chattocorp/chatto/issues/971)) ([6abb0ce](https://github.com/chattocorp/chatto/commit/6abb0ce1993618c39fc3d85ba3639e9be5348998))


### Bug Fixes

* **composer:** preserve trailing hashes in headings ([#967](https://github.com/chattocorp/chatto/issues/967)) ([3028cb2](https://github.com/chattocorp/chatto/commit/3028cb215a09d15f2ac5ed2216377f4d20ed9484))
* **frontend:** align chat control border radii ([#968](https://github.com/chattocorp/chatto/issues/968)) ([5bc44df](https://github.com/chattocorp/chatto/commit/5bc44df8e4316d57437088bc988de11b8d7d8692))
* **frontend:** improve blockquote styling ([#973](https://github.com/chattocorp/chatto/issues/973)) ([441706c](https://github.com/chattocorp/chatto/commit/441706c0385a84cb6df6cb4657f2572088e5f798))
* **frontend:** route room badges from scoped notifications ([#972](https://github.com/chattocorp/chatto/issues/972)) ([8bb1cc1](https://github.com/chattocorp/chatto/commit/8bb1cc1c6e5d44f1954b6e1532312ca03000b072))
* tighten sidebar item spacing ([#975](https://github.com/chattocorp/chatto/issues/975)) ([8aab581](https://github.com/chattocorp/chatto/commit/8aab581c698e6468d2071bbae2c862d50b8a649b))

## [0.2.3](https://github.com/chattocorp/chatto/compare/v0.2.2...v0.2.3) (2026-06-18)


### Features

* add notification sound shaping controls ([#962](https://github.com/chattocorp/chatto/issues/962)) ([585fa4b](https://github.com/chattocorp/chatto/commit/585fa4b48b058e8b0c411306815ec567a4a421b9))
* **composer:** submit with Ctrl/Cmd+Enter ([#960](https://github.com/chattocorp/chatto/issues/960)) ([461f911](https://github.com/chattocorp/chatto/commit/461f9114e33fca7bae13ac324925a928594a5d08))


### Bug Fixes

* **composer:** keep autolink boundaries editable ([#964](https://github.com/chattocorp/chatto/issues/964)) ([2170f5f](https://github.com/chattocorp/chatto/commit/2170f5f1781396a7a24defa83f667a112f6d4a52))
* **frontend:** restore push notification routing ([#957](https://github.com/chattocorp/chatto/issues/957)) ([b000610](https://github.com/chattocorp/chatto/commit/b000610da536dc26cdb5861226c6f025c1ef9647))
* support configurable Docker runtime user ([#959](https://github.com/chattocorp/chatto/issues/959)) ([edb4595](https://github.com/chattocorp/chatto/commit/edb459508b7458b08c295ac30016f000f74a3e7d))

## [0.2.2](https://github.com/chattocorp/chatto/compare/v0.2.1...v0.2.2) (2026-06-17)


### Features

* group room files by date ([#937](https://github.com/chattocorp/chatto/issues/937)) ([b13674b](https://github.com/chattocorp/chatto/commit/b13674b8a13492ae361c870b886e2fccb2456edf))
* **sidebar:** add group sidebar links ([#915](https://github.com/chattocorp/chatto/issues/915)) ([aea26da](https://github.com/chattocorp/chatto/commit/aea26da20ef0ee7afc86021e3671eaafcd67be7f))


### Bug Fixes

* log graphql errors ([#955](https://github.com/chattocorp/chatto/issues/955)) ([692bfc9](https://github.com/chattocorp/chatto/commit/692bfc95c5179ddcc869d0f154094ef226c6718c))
* represent deleted room members ([#934](https://github.com/chattocorp/chatto/issues/934)) ([91ad1dc](https://github.com/chattocorp/chatto/commit/91ad1dc2047b572df6097296ac533dc22e02b285))

## [0.2.1](https://github.com/chattocorp/chatto/compare/v0.2.0...v0.2.1) (2026-06-17)


### Features

* add room files sidebar ([#920](https://github.com/chattocorp/chatto/issues/920)) ([23e3415](https://github.com/chattocorp/chatto/commit/23e34154e899e0aeadcaa46118914f6966a6221c))
* **cli:** remove reset command ([60502e3](https://github.com/chattocorp/chatto/commit/60502e3fe11ae70943abf2c0856ab1496314349d))
* **cli:** remove reset command ([#928](https://github.com/chattocorp/chatto/issues/928)) ([3380efd](https://github.com/chattocorp/chatto/commit/3380efd91579f3c115f2d5918be14d8aa88cdd4c))


### Bug Fixes

* **e2e:** wait for posted message articles ([#923](https://github.com/chattocorp/chatto/issues/923)) ([c7d9e22](https://github.com/chattocorp/chatto/commit/c7d9e22a462e9f0f3f21762bfb9f6fc8f3155d79))
* **frontend:** confirm mention autocomplete with enter ([d28aa4e](https://github.com/chattocorp/chatto/commit/d28aa4e72d44d2cb480a06045ff215d61e87f2db))
* **frontend:** use app modal for mention confirmation ([#927](https://github.com/chattocorp/chatto/issues/927)) ([f7ff517](https://github.com/chattocorp/chatto/commit/f7ff5173bde71422a3dc45c72ac1268b91924941))
* tolerate stale room members ([#932](https://github.com/chattocorp/chatto/issues/932)) ([40c7d6c](https://github.com/chattocorp/chatto/commit/40c7d6cc0c0847764b8c02592197ee8f14657349))
* update thread replies after send ([#924](https://github.com/chattocorp/chatto/issues/924)) ([2062fdc](https://github.com/chattocorp/chatto/commit/2062fdc9f8686f44a181780b3692364b266ff65b))

## [0.2.0](https://github.com/chattocorp/chatto/compare/v0.1.0...v0.2.0) (2026-06-17)


### ⚠ BREAKING CHANGES

* **docker:** use config and data root paths ([#903](https://github.com/chattocorp/chatto/issues/903))

### Features

* add notification badge counts ([#909](https://github.com/chattocorp/chatto/issues/909)) ([f25a69d](https://github.com/chattocorp/chatto/commit/f25a69da861628ebcb3a07ca1cbc1d9e2744fcf4))
* **auth:** configure email OTP throttling ([#902](https://github.com/chattocorp/chatto/issues/902)) ([8c2d202](https://github.com/chattocorp/chatto/commit/8c2d2024b7e76df74fe3305736fa7f9683c353ac))
* **frontend:** preview Markdown in composer ([#876](https://github.com/chattocorp/chatto/issues/876)) ([06afedb](https://github.com/chattocorp/chatto/commit/06afedbc7d1662d3793c549a402bc3343eb9e37d))
* show room sidebar in DMs ([#912](https://github.com/chattocorp/chatto/issues/912)) ([32222fa](https://github.com/chattocorp/chatto/commit/32222fa82766060eb1b645fb507e1ea1ec1f2b19))


### Bug Fixes

* **auth:** make CSRF tokens stateless ([#900](https://github.com/chattocorp/chatto/issues/900)) ([a2da80c](https://github.com/chattocorp/chatto/commit/a2da80c478700c163240c3c5a816386b1d58c78f))
* **ci:** checkout docs image PR refs ([#906](https://github.com/chattocorp/chatto/issues/906)) ([a2af9a2](https://github.com/chattocorp/chatto/commit/a2af9a294946aecea76cb121d66ed21f220bc11b))
* **docker:** use config and data root paths ([#903](https://github.com/chattocorp/chatto/issues/903)) ([c90f0d9](https://github.com/chattocorp/chatto/commit/c90f0d9a4ee0711f16143cb28904dc7623ef39c6))
* **frontend:** remount room on notification switch ([#908](https://github.com/chattocorp/chatto/issues/908)) ([fcba838](https://github.com/chattocorp/chatto/commit/fcba83843711a568e0356518bd25e78fe06835b8))
* **frontend:** show active call badges for DMs ([#899](https://github.com/chattocorp/chatto/issues/899)) ([a7299e1](https://github.com/chattocorp/chatto/commit/a7299e15978c6b03ccd10889dc27d04e483851ad))
* refresh room layout state after room creation ([#907](https://github.com/chattocorp/chatto/issues/907)) ([7cd94d2](https://github.com/chattocorp/chatto/commit/7cd94d27c86fcc09f669e36bfc92031271785633))
* support implicit SMTP TLS ([#905](https://github.com/chattocorp/chatto/issues/905)) ([d7d83b1](https://github.com/chattocorp/chatto/commit/d7d83b1a98bf6bcf199776e188f9647b9c23cf78))
* tidy server lifecycle logs ([#914](https://github.com/chattocorp/chatto/issues/914)) ([2b95bf4](https://github.com/chattocorp/chatto/commit/2b95bf42c1687ad8c2c3a91c589c68084eb2be5f))

## [0.1.0](https://github.com/chattocorp/chatto/compare/v0.1.0-rc.0...v0.1.0) (2026-06-16)


### Features

* **auth:** use bearer tokens for origin GraphQL ([#897](https://github.com/chattocorp/chatto/issues/897)) ([cf9b552](https://github.com/chattocorp/chatto/commit/cf9b55294fd0b17636a181a35cb84ac9699ea85a))


### Bug Fixes

* **frontend:** keep sidebars visible on fresh sessions ([#891](https://github.com/chattocorp/chatto/issues/891)) ([1cb5717](https://github.com/chattocorp/chatto/commit/1cb571721e7ead02ca8cfd12d961937ad5f648fb))
* **frontend:** remember last visited DM rooms ([#894](https://github.com/chattocorp/chatto/issues/894)) ([de8efb0](https://github.com/chattocorp/chatto/commit/de8efb0f8a827d4f9e40c103fe429d4e7674fb8e))

## [0.1.0-rc.0](https://github.com/chattocorp/chatto/compare/v0.1.0-beta.6...v0.1.0-rc.0) (2026-06-16)


### ⚠ BREAKING CHANGES

* refresh current room on reconnect ([#878](https://github.com/chattocorp/chatto/issues/878))
* **auth:** stabilize cookie session auth ([#883](https://github.com/chattocorp/chatto/issues/883))
* simplify RBAC permissions ([#880](https://github.com/chattocorp/chatto/issues/880))

### Features

* add per-process Prometheus metrics ([#877](https://github.com/chattocorp/chatto/issues/877)) ([34a88e5](https://github.com/chattocorp/chatto/commit/34a88e5b3608f87b778ecbc3a67120df404cbb30))
* **auth:** support external auth providers ([#873](https://github.com/chattocorp/chatto/issues/873)) ([ff2fb06](https://github.com/chattocorp/chatto/commit/ff2fb0681832cd1915004117b27b0cc43781a782))
* make LiveKit reconciliation resilient ([#869](https://github.com/chattocorp/chatto/issues/869)) ([82a5bc9](https://github.com/chattocorp/chatto/commit/82a5bc937c503203ae2bc557cc788f1a14c47b0b))
* show call lifecycle notices in room events ([#867](https://github.com/chattocorp/chatto/issues/867)) ([b652c4f](https://github.com/chattocorp/chatto/commit/b652c4f9511359bc89b68ccf51ec4a232317ea5d))


### Bug Fixes

* **auth:** stabilize cookie session auth ([#883](https://github.com/chattocorp/chatto/issues/883)) ([376a268](https://github.com/chattocorp/chatto/commit/376a268595420601f78c328fae38969648638644))
* **cli:** improve generated chatto config defaults ([#872](https://github.com/chattocorp/chatto/issues/872)) ([7ba64b7](https://github.com/chattocorp/chatto/commit/7ba64b779dbdd8ee4147dcc541ea19d1960a213e))
* **config:** tighten chatto config validation ([#868](https://github.com/chattocorp/chatto/issues/868)) ([8b45012](https://github.com/chattocorp/chatto/commit/8b450122fd52e043fecea4cb87042ae2ba73df1a))
* **core:** align projection snapshots with OCC ([#864](https://github.com/chattocorp/chatto/issues/864)) ([f805493](https://github.com/chattocorp/chatto/commit/f80549386bcab39a0cb2a2874cd0724b7dac8fc9))
* **frontend:** prevent expired edit via ArrowUp ([#879](https://github.com/chattocorp/chatto/issues/879)) ([bbae3aa](https://github.com/chattocorp/chatto/commit/bbae3aa576a7a036f7567753bb38925afbd1bea6))
* ignore markdown code mentions and previews ([#866](https://github.com/chattocorp/chatto/issues/866)) ([37933cb](https://github.com/chattocorp/chatto/commit/37933cbd552e406ee7e2ad5a48d7f56449886ce5))
* refresh current room on reconnect ([#878](https://github.com/chattocorp/chatto/issues/878)) ([8066af7](https://github.com/chattocorp/chatto/commit/8066af79bc669ad613a496615719a103385c70d2))
* remember sidebar visibility preferences ([#862](https://github.com/chattocorp/chatto/issues/862)) ([ec13041](https://github.com/chattocorp/chatto/commit/ec130411d1a6279e3e5ad218f77281d2382d7e55))


### Code Refactoring

* simplify RBAC permissions ([#880](https://github.com/chattocorp/chatto/issues/880)) ([37fe2c6](https://github.com/chattocorp/chatto/commit/37fe2c6dac274a4edf48c5051b7ecfcb04dcdcfb))

## [0.1.0-beta.6](https://github.com/chattocorp/chatto/compare/v0.1.0-beta.5...v0.1.0-beta.6) (2026-06-15)


### Features

* add durable LiveKit call events and E2EE ([#835](https://github.com/chattocorp/chatto/issues/835)) ([8d91797](https://github.com/chattocorp/chatto/commit/8d91797e842e68072f14fcd2aa9543c2ade1d477))
* add role mentions ([#825](https://github.com/chattocorp/chatto/issues/825)) ([cc95f73](https://github.com/chattocorp/chatto/commit/cc95f73460e868cd41cb6103f8b6587c79d38010))
* add room extras sidebar tabs ([#856](https://github.com/chattocorp/chatto/issues/856)) ([99dff21](https://github.com/chattocorp/chatto/commit/99dff210ddb95b7c4162d1f63767f4e951f6ff4a))
* **admin:** auto-paginate event log ([#852](https://github.com/chattocorp/chatto/issues/852)) ([cbee54f](https://github.com/chattocorp/chatto/commit/cbee54fa88bf6e47424a30e9f92ef7b16b05da66))
* allow editing thread reply channel echoes ([#847](https://github.com/chattocorp/chatto/issues/847)) ([a5abd5a](https://github.com/chattocorp/chatto/commit/a5abd5a3b4b2c1c06504fcdbd5a512c8346405d6))
* **frontend:** find server users in cmd-k ([#844](https://github.com/chattocorp/chatto/issues/844)) ([26283ce](https://github.com/chattocorp/chatto/commit/26283ce5818766fa4a94bc147f6a865478669d68))


### Bug Fixes

* add CSRF protection for cookie sessions ([#851](https://github.com/chattocorp/chatto/issues/851)) ([ccc8d69](https://github.com/chattocorp/chatto/commit/ccc8d6961d8e05095b025d8ea89101d604258e9d))
* attribute RBAC audit events to actors ([#834](https://github.com/chattocorp/chatto/issues/834)) ([0e89890](https://github.com/chattocorp/chatto/commit/0e898907f45da420c6728e75ff4b7fe86ae34911))
* **core:** end stuck calls when LiveKit fails ([#860](https://github.com/chattocorp/chatto/issues/860)) ([fbe1644](https://github.com/chattocorp/chatto/commit/fbe1644f931b8cadb3a2ed457557450fc89adb09))
* **frontend:** auto-paginate admin members ([#846](https://github.com/chattocorp/chatto/issues/846)) ([7fff051](https://github.com/chattocorp/chatto/commit/7fff0510133d31d31ed412ef639ab374e03970bd))
* **frontend:** paginate room member sidebar ([#833](https://github.com/chattocorp/chatto/issues/833)) ([1e87d98](https://github.com/chattocorp/chatto/commit/1e87d9855e9c2918539085a76780a6c5d19df226))
* **frontend:** remove server header leave icon ([#855](https://github.com/chattocorp/chatto/issues/855)) ([360bdca](https://github.com/chattocorp/chatto/commit/360bdcabd458eb7d0f8b16bac649b8c940c1b217))
* **frontend:** stabilize presence display ([#850](https://github.com/chattocorp/chatto/issues/850)) ([1901ca2](https://github.com/chattocorp/chatto/commit/1901ca24982a879b242001951ccd0e2080ee8198))
* **frontend:** use commit hash for dev app version ([#857](https://github.com/chattocorp/chatto/issues/857)) ([2a7f73e](https://github.com/chattocorp/chatto/commit/2a7f73ee3eb2b594db916a29d6c93cf2ad73b450))
* **logging:** stop logging user PII ([#830](https://github.com/chattocorp/chatto/issues/830)) ([6f1b558](https://github.com/chattocorp/chatto/commit/6f1b558278f2216e88ab02a93df59579fbec2be8))
* preserve session auth for GraphQL CSRF ([#858](https://github.com/chattocorp/chatto/issues/858)) ([4b1507d](https://github.com/chattocorp/chatto/commit/4b1507d7826e89bb967adec16f1e12ded14534fa))
* refine conversation start marker UX ([#839](https://github.com/chattocorp/chatto/issues/839)) ([862a617](https://github.com/chattocorp/chatto/commit/862a617b216fe3cf4dab7099163ca36a6696de87))
* replay missed subscription events ([#832](https://github.com/chattocorp/chatto/issues/832)) ([eeec111](https://github.com/chattocorp/chatto/commit/eeec111e41fc6037d53e22a932f9e8a209b80440))
* validate cookie encryption secret early ([#842](https://github.com/chattocorp/chatto/issues/842)) ([899953c](https://github.com/chattocorp/chatto/commit/899953ce48b277e4488fd0f01e0d316033ddc16c))


### Performance Improvements

* **threads:** paginate My Threads ([#837](https://github.com/chattocorp/chatto/issues/837)) ([7d4afab](https://github.com/chattocorp/chatto/commit/7d4afab47f0054b756c290a8a8c72fd752589b93))

## [0.1.0-beta.5](https://github.com/chattocorp/chatto/compare/v0.1.0-beta.4...v0.1.0-beta.5) (2026-06-13)


### Bug Fixes

* **frontend:** cache reply previews during scroll ([#819](https://github.com/chattocorp/chatto/issues/819)) ([fc2c629](https://github.com/chattocorp/chatto/commit/fc2c62963909c692a91c36151958b3aceb959de5))
* **frontend:** crop server sidebar banners ([#822](https://github.com/chattocorp/chatto/issues/822)) ([41ad36b](https://github.com/chattocorp/chatto/commit/41ad36b1756dca529eaba8a255f0f3789533f6d1))
* ignore foreign LiveKit webhooks ([de90c89](https://github.com/chattocorp/chatto/commit/de90c89a4356634eaf956ee14ad650bbb3aedd9a))

## [0.1.0-beta.4](https://github.com/chattocorp/chatto/compare/v0.1.0-beta.3...v0.1.0-beta.4) (2026-06-12)


### Features

* **pwa:** enrich web app manifest ([#808](https://github.com/chattocorp/chatto/issues/808)) ([2c6fe8b](https://github.com/chattocorp/chatto/commit/2c6fe8be747f7041706128c43c5d97403ca8a4cf))


### Bug Fixes

* emit structured logs for Loki ([#815](https://github.com/chattocorp/chatto/issues/815)) ([25ab64a](https://github.com/chattocorp/chatto/commit/25ab64a48d4bea686bf2c2e09a11d0f5e711f562))
* harden backend shutdown handling ([#814](https://github.com/chattocorp/chatto/issues/814)) ([59d344b](https://github.com/chattocorp/chatto/commit/59d344b5839c252e12ab88b74d5fc9d16bece5f6))
* Harden Docker images ([0b227e9](https://github.com/chattocorp/chatto/commit/0b227e9c131ddab9983b3fa07d152ca80cfb441e))
* improve web push provider compatibility ([#816](https://github.com/chattocorp/chatto/issues/816)) ([2e0d464](https://github.com/chattocorp/chatto/commit/2e0d464b141c821c673b74cea2235265617943c2))
* **projections:** fail visibly on projection errors ([#803](https://github.com/chattocorp/chatto/issues/803)) ([6959161](https://github.com/chattocorp/chatto/commit/695916195f1a3aaa087b5264f2cec95f8fa12070))
* **projections:** introduce stream positions and services ([#812](https://github.com/chattocorp/chatto/issues/812)) ([240970c](https://github.com/chattocorp/chatto/commit/240970c749cf4da90fad6a23b163b3a96550d465))

## [0.1.0-beta.3](https://github.com/chattocorp/chatto/compare/v0.1.0-beta.2...v0.1.0-beta.3) (2026-06-12)


### Bug Fixes

* **timeline:** preserve migrated room join order ([#801](https://github.com/chattocorp/chatto/issues/801)) ([53547ca](https://github.com/chattocorp/chatto/commit/53547ca794af634fe60bcbcaa98fc7477bb64da1))

## [0.1.0-beta.2](https://github.com/chattocorp/chatto/compare/v0.1.0-beta.1...v0.1.0-beta.2) (2026-06-11)


### Features

* **proto:** stabilize event schemas for beta ([#797](https://github.com/chattocorp/chatto/issues/797)) ([ef3c601](https://github.com/chattocorp/chatto/commit/ef3c6018b4d112c00e320d301e0c6b94156cb53b))

## [0.1.0-beta.1](https://github.com/chattocorp/chatto/compare/v0.1.0-beta.0...v0.1.0-beta.1) (2026-06-11)


### Bug Fixes

* **auth:** add OAuth redirect origin allowlist ([#796](https://github.com/chattocorp/chatto/issues/796)) ([7cbc486](https://github.com/chattocorp/chatto/commit/7cbc486b371bedde2cdb0e9d59d09259f2fa0b90))
* **auth:** include server name in auth emails ([#793](https://github.com/chattocorp/chatto/issues/793)) ([19dd784](https://github.com/chattocorp/chatto/commit/19dd78470adac1e773fe91440c8ea354a06224e0))

## [0.1.0-beta.0](https://github.com/chattocorp/chatto/compare/v0.1.0-alpha.3...v0.1.0-beta.0) (2026-06-10)


### Features

* add s3 asset path prefix ([#784](https://github.com/chattocorp/chatto/issues/784)) ([bbf0262](https://github.com/chattocorp/chatto/commit/bbf02628114a44decab802285b3f9559f0a5597e))
* **auth:** add OAuth consent flow ([#791](https://github.com/chattocorp/chatto/issues/791)) ([b401b57](https://github.com/chattocorp/chatto/commit/b401b57ac8d95b7cbba14d4b7650b4adb31ba8d7))
* **frontend:** inline admin sidebar navigation ([#785](https://github.com/chattocorp/chatto/issues/785)) ([0be5f68](https://github.com/chattocorp/chatto/commit/0be5f6887be92797730fb8a6b48aa36fcf19529d))
* **moderation:** add channel room bans ([#777](https://github.com/chattocorp/chatto/issues/777)) ([abc107b](https://github.com/chattocorp/chatto/commit/abc107b0fd188be62e5d676d0b81d2a3596d5a6c))
* proxy asset URLs through service worker ([#781](https://github.com/chattocorp/chatto/issues/781)) ([309d0b0](https://github.com/chattocorp/chatto/commit/309d0b09be68e127d94c4e7da5d46d9f91e0a993))


### Bug Fixes

* **assets:** sandbox active attachment responses ([#788](https://github.com/chattocorp/chatto/issues/788)) ([f98f826](https://github.com/chattocorp/chatto/commit/f98f82694441dd359983b9ad078a4ae20d5bd1dd))
* **auth:** restrict OAuth redirect origins ([#786](https://github.com/chattocorp/chatto/issues/786)) ([50268a6](https://github.com/chattocorp/chatto/commit/50268a6e41188c920c729300253eaf83375cd79a))
* consolidate server config live events ([#783](https://github.com/chattocorp/chatto/issues/783)) ([995e663](https://github.com/chattocorp/chatto/commit/995e663b96ffada126a21e0b5256830ad296fe93))
* **es:** canonicalize legacy import verification ([1af33ac](https://github.com/chattocorp/chatto/commit/1af33ac34ca03fad9c05951b9a23cd81fa63e986))
* refresh expiring attachment asset URLs ([#779](https://github.com/chattocorp/chatto/issues/779)) ([2de2dde](https://github.com/chattocorp/chatto/commit/2de2ddeda62e8493ae59f409bd82434711dbca08))


### Miscellaneous Chores

* force beta prerelease ([c6833b4](https://github.com/chattocorp/chatto/commit/c6833b41b15c9a4ccd7d772ead3684d641134ae1))

## [0.1.0-alpha.3](https://github.com/chattocorp/chatto/compare/v0.1.0-alpha.2...v0.1.0-alpha.3) (2026-06-08)


### ⚠ BREAKING CHANGES

* **graphql:** consolidate list field shapes ([#770](https://github.com/chattocorp/chatto/issues/770))

### Features

* add compact encrypted data envelopes ([#704](https://github.com/chattocorp/chatto/issues/704)) ([4c6b7b6](https://github.com/chattocorp/chatto/commit/4c6b7b644f57b12a4c92b161caa7a331286c9d57))
* add ES rollout observability ([#709](https://github.com/chattocorp/chatto/issues/709)) ([2c0cb34](https://github.com/chattocorp/chatto/commit/2c0cb348589fd7234cf7424e2f8b4dfe7bf2e789))
* add explicit room thread creation events ([#722](https://github.com/chattocorp/chatto/issues/722)) ([2de3459](https://github.com/chattocorp/chatto/commit/2de345947400916514ad40759f3719242fa87489))
* add server-admin system diagnostics ([#720](https://github.com/chattocorp/chatto/issues/720)) ([64e23f0](https://github.com/chattocorp/chatto/commit/64e23f0719905037feaaf1073a2e5a93548997df))
* add server-side cookie sessions ([#732](https://github.com/chattocorp/chatto/issues/732)) ([3a0b224](https://github.com/chattocorp/chatto/commit/3a0b224507a99cf2b5c6f355f9362a59cc4d4ae8))
* add shreddable message body events ([#729](https://github.com/chattocorp/chatto/issues/729)) ([ea05797](https://github.com/chattocorp/chatto/commit/ea057972b3f96e5a73d70441de420d8413415c85))
* audit auth token workflows ([#697](https://github.com/chattocorp/chatto/issues/697)) ([fce12a4](https://github.com/chattocorp/chatto/commit/fce12a42c49944777e81a3816db87ccdaf677d86))
* **auth:** use OTP codes for email verification ([#771](https://github.com/chattocorp/chatto/issues/771)) ([0bf1905](https://github.com/chattocorp/chatto/commit/0bf19057102cc16eb1baa43f45b17f0183233d77))
* **frontend:** polish service worker shell caching ([#773](https://github.com/chattocorp/chatto/issues/773)) ([b842901](https://github.com/chattocorp/chatto/commit/b842901ed23ba2ec1af243fb28a456facbd776be))
* **graphql:** clean up schema hygiene ([#724](https://github.com/chattocorp/chatto/issues/724)) ([f68ae54](https://github.com/chattocorp/chatto/commit/f68ae54eb3786aa8c9eb3bac6577bc2597d3bade))
* harden encryption key storage ([#710](https://github.com/chattocorp/chatto/issues/710)) ([0bf76e7](https://github.com/chattocorp/chatto/commit/0bf76e7d1199cd89853344ee73ea6402393a7a72))
* move presence and calls to memory cache ([#702](https://github.com/chattocorp/chatto/issues/702)) ([c98aacf](https://github.com/chattocorp/chatto/commit/c98aacf52fb4c1dd444270e3b547443ed841d6c5))
* store link preview cache in runtime state ([#708](https://github.com/chattocorp/chatto/issues/708)) ([d5832c4](https://github.com/chattocorp/chatto/commit/d5832c41ce92de5ee9125547eb1c0eb74ae78fd6))


### Bug Fixes

* add GraphQL length validation ([#751](https://github.com/chattocorp/chatto/issues/751)) ([715a3b4](https://github.com/chattocorp/chatto/commit/715a3b4635ba4f1cacf40d1a19f5346c9ab30d5a))
* add HTTP server timeout hardening ([#723](https://github.com/chattocorp/chatto/issues/723)) ([880628e](https://github.com/chattocorp/chatto/commit/880628e98e8a4e322e08f88124257b72fcf59d9f))
* add report-only CSP header ([#728](https://github.com/chattocorp/chatto/issues/728)) ([74e6200](https://github.com/chattocorp/chatto/commit/74e62006b575e75836ff833d35e7b93aca56f9d5))
* **auth:** revoke credentials after password changes ([#752](https://github.com/chattocorp/chatto/issues/752)) ([e1adcbd](https://github.com/chattocorp/chatto/commit/e1adcbd4a23110e6f1b9808a5fea9f467d42bd7f))
* autofocus login identifier field ([#727](https://github.com/chattocorp/chatto/issues/727)) ([f349bba](https://github.com/chattocorp/chatto/commit/f349bba0c5dd903f22efc8b54d1989b889380585))
* clamp room event query limits ([#735](https://github.com/chattocorp/chatto/issues/735)) ([75bf8e0](https://github.com/chattocorp/chatto/commit/75bf8e064c08a6006570990cae87af150486e60d))
* clean up cached asset derivatives on deletion ([#766](https://github.com/chattocorp/chatto/issues/766)) ([f7a6d04](https://github.com/chattocorp/chatto/commit/f7a6d04517e72281f1d3f9241631cba0ed077700))
* **core:** consolidate NATS asset storage ([#768](https://github.com/chattocorp/chatto/issues/768)) ([1eaca2b](https://github.com/chattocorp/chatto/commit/1eaca2b93492d17b674af1e9c69e34751c4f6919))
* disable video uploads when processing is off ([#695](https://github.com/chattocorp/chatto/issues/695)) ([4a31d1a](https://github.com/chattocorp/chatto/commit/4a31d1a1d07d948bc933d73fb9194c6bdd1aa7f3))
* enforce core string length limits ([#741](https://github.com/chattocorp/chatto/issues/741)) ([3c64b17](https://github.com/chattocorp/chatto/commit/3c64b17af6d723fb8c3597a4d84e970babf347a2))
* **frontend:** disable composer submit while attachments stage ([#711](https://github.com/chattocorp/chatto/issues/711)) ([fdb1831](https://github.com/chattocorp/chatto/commit/fdb1831b5b5fabb402a4c021ceb39aca73ae0f70))
* **frontend:** keep failed server icons visible ([#772](https://github.com/chattocorp/chatto/issues/772)) ([7b974d6](https://github.com/chattocorp/chatto/commit/7b974d6a4e52f01c8735ce8b311f91af6d486ddc))
* **graphql:** widen event log total count ([#760](https://github.com/chattocorp/chatto/issues/760)) ([79ebf41](https://github.com/chattocorp/chatto/commit/79ebf414332077a6bfc96df23202c6902c7de645))
* harden OIDC avatar fetching ([#739](https://github.com/chattocorp/chatto/issues/739)) ([7b82ad7](https://github.com/chattocorp/chatto/commit/7b82ad7a997533a0d1959e2f52fc060bb606a88d))
* hide echoes on direct retraction ([#701](https://github.com/chattocorp/chatto/issues/701)) ([035601b](https://github.com/chattocorp/chatto/commit/035601bdedceae0255ca07ccd6e5cf689a1ec4f2))
* limit GraphQL JSON request body size ([#740](https://github.com/chattocorp/chatto/issues/740)) ([8cae516](https://github.com/chattocorp/chatto/commit/8cae5164f15a0adf98d95746b5cf01fffea4a2c3))
* make message ES importer non-atomic ([#733](https://github.com/chattocorp/chatto/issues/733)) ([651780b](https://github.com/chattocorp/chatto/commit/651780bb0d3f0ccdd80f009f6319467bb77fcc70))
* paginate unbounded GraphQL list fields ([#726](https://github.com/chattocorp/chatto/issues/726)) ([1e7d5e8](https://github.com/chattocorp/chatto/commit/1e7d5e802e509447584b2c83ce60c100065e5ebb))
* require mandatory SMTP TLS by default ([#725](https://github.com/chattocorp/chatto/issues/725)) ([ecad9c5](https://github.com/chattocorp/chatto/commit/ecad9c5c6fbe6a4b036c902643740c306a245183))


### Performance Improvements

* optimize room timeline projection reads ([#734](https://github.com/chattocorp/chatto/issues/734)) ([2265ee8](https://github.com/chattocorp/chatto/commit/2265ee8e7c2dc845ee857b2cb714c4cebba80ca7))


### Code Refactoring

* **graphql:** consolidate list field shapes ([#770](https://github.com/chattocorp/chatto/issues/770)) ([b20beda](https://github.com/chattocorp/chatto/commit/b20beda1ee92395f1dddde831c7a44dcc3679203))

## [0.1.0-alpha.2](https://github.com/chattocorp/chatto/compare/v0.1.0-alpha.1...v0.1.0-alpha.2) (2026-06-01)


### Features

* add EVT auth audit events ([#687](https://github.com/chattocorp/chatto/issues/687)) ([dc50aa2](https://github.com/chattocorp/chatto/commit/dc50aa2d126f3891b5a490a27d8eace297db8bcc))
* hmac runtime token storage ([#688](https://github.com/chattocorp/chatto/issues/688)) ([c9d0065](https://github.com/chattocorp/chatto/commit/c9d0065d809da2db45972b2b2096ff7f53ee710c))
* remove DM-specific permissions ([#683](https://github.com/chattocorp/chatto/issues/683)) ([5efe07b](https://github.com/chattocorp/chatto/commit/5efe07b0e8733bc98000100b1d893eabc9982600))


### Bug Fixes

* **frontend:** disable composer submit while attachments stage ([#711](https://github.com/chattocorp/chatto/issues/711)) ([fdb1831](https://github.com/chattocorp/chatto/commit/fdb1831b5b5fabb402a4c021ceb39aca73ae0f70))
* move thread follow state to runtime state ([#685](https://github.com/chattocorp/chatto/issues/685)) ([bb052ba](https://github.com/chattocorp/chatto/commit/bb052ba787a4c5963854aa4945269ce08f5f7296))
* stabilize scroll fade overlays ([#681](https://github.com/chattocorp/chatto/issues/681)) ([d471189](https://github.com/chattocorp/chatto/commit/d471189f24802b9024f25883acb8ccfed8fe7e63))

## [0.1.0-alpha.1](https://github.com/chattocorp/chatto/compare/v0.1.0-alpha.0...v0.1.0-alpha.1) (2026-05-30)


### Bug Fixes

* apply config owners on startup ([#679](https://github.com/chattocorp/chatto/issues/679)) ([e695255](https://github.com/chattocorp/chatto/commit/e695255faca58ee8ebb177564d05ce61ad20e4c6))
* **ci:** let next prereleases increment ([4a14557](https://github.com/chattocorp/chatto/commit/4a14557472746fc18a8b5365bf45adbb2f70265f))
* **ci:** use prerelease versioning on next ([833a8a1](https://github.com/chattocorp/chatto/commit/833a8a1bc7482244a403c22b365087d030a2c5aa))
* deduplicate room join events ([#672](https://github.com/chattocorp/chatto/issues/672)) ([a018184](https://github.com/chattocorp/chatto/commit/a0181849bed524565a33a9fde72276e14486cfa6))

## [0.1.0-alpha.0](https://github.com/chattocorp/chatto/compare/v0.0.189...v0.1.0-alpha.0) (2026-05-29)


### Features

* **admin:** add projection runtime diagnostics ([#646](https://github.com/chattocorp/chatto/issues/646)) ([178cd8e](https://github.com/chattocorp/chatto/commit/178cd8e884dea7f8f5808527947b07d3ac2ed562))
* **core:** messages and threads projections for event-sourced reads ([#614](https://github.com/chattocorp/chatto/issues/614)) ([a8b5585](https://github.com/chattocorp/chatto/commit/a8b55856937d3985f9c39af8151986bc52e2c0fc))
* **es:** harden local rollout imports ([#642](https://github.com/chattocorp/chatto/issues/642)) ([82207b2](https://github.com/chattocorp/chatto/commit/82207b22dae0bc25a953b7cc5060994992cc7465))
* event-source user accounts ([#650](https://github.com/chattocorp/chatto/issues/650)) ([7964a63](https://github.com/chattocorp/chatto/commit/7964a63d2d8be993f465f248e95f924822e78a1e))
* **graphql:** expose message edit events ([#664](https://github.com/chattocorp/chatto/issues/664)) ([f31c62a](https://github.com/chattocorp/chatto/commit/f31c62ad45e7d4c7ff72faa40200fc419d76e387))
* move video asset manifests into EVT ([#669](https://github.com/chattocorp/chatto/issues/669)) ([0e75502](https://github.com/chattocorp/chatto/commit/0e75502827ae60b471d407251aeaf8a1f9ca7d41))
* **proto:** durable message edit/retract events for ES migration ([#606](https://github.com/chattocorp/chatto/issues/606)) ([c237a46](https://github.com/chattocorp/chatto/commit/c237a46d7b91b6fc4369eec8754b34cab7d97f07))
* **reactions:** move reactions to event sourcing ([#635](https://github.com/chattocorp/chatto/issues/635)) ([e8140b6](https://github.com/chattocorp/chatto/commit/e8140b65358adc515f46db87255c0a44b84f8dd2))
* **storage:** move read markers to runtime state ([#661](https://github.com/chattocorp/chatto/issues/661)) ([14131d3](https://github.com/chattocorp/chatto/commit/14131d3de48696fb4558c7de3031b2b4f31d3ae6))


### Bug Fixes

* **ci:** start the prerelease line on 0.1.0-alpha.0 ([#613](https://github.com/chattocorp/chatto/issues/613)) ([6a4b767](https://github.com/chattocorp/chatto/commit/6a4b7671191edb676d55657090a9647842272676))
* **ci:** stop release-please runaway PR loop ([#622](https://github.com/chattocorp/chatto/issues/622)) ([49e6350](https://github.com/chattocorp/chatto/commit/49e6350e30403743122d880ec44366eb01bfc803))
* **ci:** tighten release-please trigger to not match its own branches ([03dea0f](https://github.com/chattocorp/chatto/commit/03dea0f27f3ac3119646dfe1eb286513f0b72859))
* **es:** harden event-sourcing OCC behavior ([#649](https://github.com/chattocorp/chatto/issues/649)) ([8dd6783](https://github.com/chattocorp/chatto/commit/8dd67831c84a319fcb9883975ffe441bef1879f1))
* **es:** preserve imported thread replies ([#648](https://github.com/chattocorp/chatto/issues/648)) ([d64a045](https://github.com/chattocorp/chatto/commit/d64a045ccc146b3dc97489d0ebf02813ce010ce6))
* **frontend:** catch up missed messages after sleep + refactor message-store lifecycle ([#631](https://github.com/chattocorp/chatto/issues/631)) ([1bf2c51](https://github.com/chattocorp/chatto/commit/1bf2c51598d6df109558aa90013addb1ebfb77ca))
* **frontend:** clean utility story links ([#653](https://github.com/chattocorp/chatto/issues/653)) ([06e608f](https://github.com/chattocorp/chatto/commit/06e608f96c4f0a8d2ac155144d8f3581d5592c41))
* **frontend:** refresh attachment URLs on lightbox open and download click ([#616](https://github.com/chattocorp/chatto/issues/616)) ([23973ac](https://github.com/chattocorp/chatto/commit/23973acb977e1cfa8b8149885c0ba23ce1e7a315))
* **frontend:** refresh scroll fades on content changes ([1f01dbe](https://github.com/chattocorp/chatto/commit/1f01dbe4da2449300bed9ee2229da38b4f6db1f3))
* refresh attachment URLs for image viewer ([#637](https://github.com/chattocorp/chatto/issues/637)) ([1324ce1](https://github.com/chattocorp/chatto/commit/1324ce1970d3d5077eae5bcadd002adcbae6f247))

## [0.0.192](https://github.com/chattocorp/chatto/compare/v0.0.191...v0.0.192) (2026-05-26)


### Bug Fixes

* **frontend:** refresh scroll fades on content changes ([1f01dbe](https://github.com/chattocorp/chatto/commit/1f01dbe4da2449300bed9ee2229da38b4f6db1f3))
* refresh attachment URLs for image viewer ([#637](https://github.com/chattocorp/chatto/issues/637)) ([1324ce1](https://github.com/chattocorp/chatto/commit/1324ce1970d3d5077eae5bcadd002adcbae6f247))

## [0.0.191](https://github.com/chattocorp/chatto/compare/v0.0.190...v0.0.191) (2026-05-26)


### Bug Fixes

* **frontend:** catch up missed messages after sleep + refactor message-store lifecycle ([#631](https://github.com/chattocorp/chatto/issues/631)) ([1bf2c51](https://github.com/chattocorp/chatto/commit/1bf2c51598d6df109558aa90013addb1ebfb77ca))

## [0.0.190](https://github.com/chattocorp/chatto/compare/v0.0.189...v0.0.190) (2026-05-25)


### Bug Fixes

* **ci:** stop release-please runaway PR loop ([#622](https://github.com/chattocorp/chatto/issues/622)) ([49e6350](https://github.com/chattocorp/chatto/commit/49e6350e30403743122d880ec44366eb01bfc803))
* **frontend:** refresh attachment URLs on lightbox open and download click ([#616](https://github.com/chattocorp/chatto/issues/616)) ([23973ac](https://github.com/chattocorp/chatto/commit/23973acb977e1cfa8b8149885c0ba23ce1e7a315))

## [0.0.189](https://github.com/chattocorp/chatto/compare/v0.0.188...v0.0.189) (2026-05-24)


### Features

* **docker:** ship nats CLI in production image, pre-wired to chatto's NATS ([#591](https://github.com/chattocorp/chatto/issues/591)) ([58ebfb1](https://github.com/chattocorp/chatto/commit/58ebfb1ddcc6690beb09b46aabdf4938c058e85d))

## [0.0.188](https://github.com/chattocorp/chatto/compare/v0.0.187...v0.0.188) (2026-05-24)


### Bug Fixes

* **assets:** per-user signed URLs so remote-server attachments load cross-origin ([#589](https://github.com/chattocorp/chatto/issues/589)) ([6f08d31](https://github.com/chattocorp/chatto/commit/6f08d31007d8b3ef357e89faa9e96cfd1d7420f8))

## [0.0.187](https://github.com/chattocorp/chatto/compare/v0.0.186...v0.0.187) (2026-05-24)


### Features

* **rooms:** seed announcements and general on fresh server boot ([#586](https://github.com/chattocorp/chatto/issues/586)) ([1a82f91](https://github.com/chattocorp/chatto/commit/1a82f918f6a096cc584ebf92ae918b82f34f0c9d))


### Bug Fixes

* **assets:** probe storage backends when Attachment.Storage is missing ([#588](https://github.com/chattocorp/chatto/issues/588)) ([86f7b7c](https://github.com/chattocorp/chatto/commit/86f7b7c1abca4e57064ea63b9cf603b829ca3eb3))

## [0.0.186](https://github.com/chattocorp/chatto/compare/v0.0.185...v0.0.186) (2026-05-24)


### Miscellaneous Chores

* cut release 0.0.186 ([3f6e05e](https://github.com/chattocorp/chatto/commit/3f6e05e9899bb3dff94e7a2bf16f662b59e57b6c))

## [0.0.185](https://github.com/chattocorp/chatto/compare/v0.0.184...v0.0.185) (2026-05-22)


### Bug Fixes

* **migrations:** backfill records for video variants and thumbnails ([#577](https://github.com/chattocorp/chatto/issues/577)) ([ca43ce8](https://github.com/chattocorp/chatto/commit/ca43ce8300101ea679dfc7066c2b588db7a815c0))

## [0.0.184](https://github.com/chattocorp/chatto/compare/v0.0.183...v0.0.184) (2026-05-22)


### Bug Fixes

* **assets:** authorize attachment downloads via canonical Attachment records ([#575](https://github.com/chattocorp/chatto/issues/575)) ([c3ab155](https://github.com/chattocorp/chatto/commit/c3ab155deb72c3c1781457c3773bab7402c2519c))

## [0.0.183](https://github.com/chattocorp/chatto/compare/v0.0.182...v0.0.183) (2026-05-22)


### Features

* **ci:** adopt release-please, retire `mise bump` ([#573](https://github.com/chattocorp/chatto/issues/573)) ([2eb2f67](https://github.com/chattocorp/chatto/commit/2eb2f678ac708316df7f04c3d8592308c7aa1c44))

## 0.0.182

Baseline. History prior to release-please adoption is preserved in git
tags `v0.0.1` … `v0.0.182` and their corresponding GitHub Releases.
