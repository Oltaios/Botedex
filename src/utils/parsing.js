/**
 * Utilitaire de lecture des donnees Pokemon depuis le CSV data/pokemonLight.csv
 * Source de verite pour les noms, types et taux de capture des Pokemon.
 *
 * Le CSV est indexe ligne par ligne : la ligne 1 (array[1]) correspond
 * au Pokemon n 1, la ligne 2 au n 2, etc. Chaque ligne est un tableau de
 * colonnes ; les constantes ci-dessous donnent l'index de chaque colonne
 * (ordre defini par l'en-tete du CSV).
 */

import fs from 'fs';

// Index des colonnes du CSV pokemonLight.csv (voir l'en-tete du fichier)
var abilities = 0;
var against_bug = 1;
var against_dark = 2;
var against_dragon = 3;
var against_electric = 4;
var against_fairy = 5;
var against_fight = 6;
var against_fire = 7;
var against_flying = 8;
var against_ghost = 9;
var against_grass = 10;
var against_ground = 11;
var against_ice = 12;
var against_normal = 13;
var against_poison = 14;
var against_psychic = 15;
var against_rock = 16;
var against_steel = 17;
var gainst_water = 18;
var attack = 19;
var base_egg_steps = 20;
var base_happiness = 21;
var base_total = 22;
var capture_rate = 23;
var classfication = 24;
var defense = 25;
var experience_growth = 26;
var height_m = 27;
var hp = 28;
var japanese_name = 29;
var nameENG = 30;
var percentage_male = 31;
var pokedex_number = 32;
var sp_attack = 33;
var sp_defense = 34;
var speed = 35;
var type1 = 36;
var type2 = 37;
var weight_kg = 38;
var generation = 39;
var is_legendary = 40;
var nameFR = 41;

/**
 * Retourne le nom et le taux de capture d'un Pokemon
 * @param {number} id - Numero du Pokemon (1 = 1ere ligne de donnees du CSV)
 * @returns {Array<string|number>|null} - [nom du Pokemon, taux de capture] ou null si id absent
 */
export function parsingPkm(id) {
    if(id != null){
        var data = fs.readFileSync('./data/pokemonLight.csv', 'utf8');
        var array = CSVToArray(data, ',');
        const nomPokeENG = array[id][nameENG]
        const tx_capture = array[id][capture_rate]
        const nomPokeFR = array[id][nameFR]
        return [nomPokeENG, tx_capture, nomPokeFR];
    }
    else{
        return null;
    }
}

/**
 * Retourne le nom et les types d'un Pokemon
 * @param {number} id - Numero du Pokemon (1 = 1ere ligne de donnees du CSV)
 * @returns {Object} - { nomPoke: string, type_1: string, type_2: string }
 */
export function parsingPkmNomType1Type2(id){
    var data = fs.readFileSync('./data/pokemonLight.csv', 'utf8');
    let array = CSVToArray(data, ',');
    let nomPoke = array[id][nameENG]
    let type_1 = array[id][type1]
    let type_2 = array[id][type2]
    //console.log("type1 " + type_1 + " type2 " + type_2)
    return {nomPoke, type_1, type_2};
}

/**
 * Retourne le nom et le poids d'un Pokemon
 * @param {number} id - Numero du Pokemon (1 = 1ere ligne de donnees du CSV)
 * @returns {Object} - { nomPoke: string, poids: string } (poids en kg)
 */
export function parsingPkmNomPoids(id){
    var data = fs.readFileSync('./data/pokemonLight.csv', 'utf8');
    let array = CSVToArray(data, ',');
    let nomPoke = array[id][nameENG]
    let poids = array[id][weight_kg]
    return {nomPoke, poids};
}

/**
 * Parse une chaine CSV en tableau 2D
 * Gere les champs entre guillemets et les guillemets doubles a l'interieur
 * @param {string} strData - Contenu brut du fichier CSV
 * @param {string} [strDelimiter] - Delimiteur de colonnes (virgule par defaut)
 * @returns {Array<Array<string>>} - Tableau de lignes, chaque ligne etant un tableau de valeurs
 */
function CSVToArray(strData, strDelimiter) {
    // Check to see if the delimiter is defined. If not,
    // then default to comma.
    strDelimiter = (strDelimiter || ",");

    // Create a regular expression to parse the CSV values.
    var objPattern = new RegExp(
        (
            // Delimiters.
            "(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +

            // Quoted fields.
            "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +

            // Standard fields.
            "([^\"\\" + strDelimiter + "\\r\\n]*))"
        ),
        "gi"
    );


    // Create an array to hold our data. Give the array
    // a default empty first row.
    var arrData = [[]];

    // Create an array to hold our individual pattern
    // matching groups.
    var arrMatches = null;


    // Keep looping over the regular expression matches
    // until we can no longer find a match.
    while (arrMatches = objPattern.exec(strData)) {

        // Get the delimiter that was found.
        var strMatchedDelimiter = arrMatches[1];

        // Check to see if the given delimiter has a length
        // (is not the start of string) and if it matches
        // field delimiter. If id does not, then we know
        // that this delimiter is a row delimiter.
        if (
            strMatchedDelimiter.length &&
            strMatchedDelimiter !== strDelimiter
        ) {

            // Since we have reached a new row of data,
            // add an empty row to our data array.
            arrData.push([]);

        }

        var strMatchedValue;

        // Now that we have our delimiter out of the way,
        // let's check to see which kind of value we
        // captured (quoted or unquoted).
        if (arrMatches[2]) {

            // We found a quoted value. When we capture
            // this value, unescape any double quotes.
            strMatchedValue = arrMatches[2].replace(
                new RegExp("\"\"", "g"),
                "\""
            );

        } else {

            // We found a non-quoted value.
            strMatchedValue = arrMatches[3];

        }


        // Now that we have our value string, let's add
        // it to the data array.
        arrData[arrData.length - 1].push(strMatchedValue);
    }

    // Return the parsed data.
    return (arrData);
}
