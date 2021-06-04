<?php require_once('config.php'); ?>

<?php
/*
Name: Gregory Hablutzel, Timmy Roma, Ella Gainey
Class: TCSS445-DB Fall-20 Al-Masri
Assignment: Group Assignment Phase 3
Description:
 - This PHP file contains the main "GeneralQueries" page for Kanto Spirit.
 - Provides buttons to proceed to the "Search By Region" or "Search By Number" queries.
 */
?>

<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kanto Spirit</title>
        <link rel="icon" href="/groupAssignment/images/KantoSpirit2.png">
        <link rel="stylesheet" href="https://bootswatch.com/4/superhero/bootstrap.min.css">

        <style>
            /* styling for images*/
            img {
                display: block;
                margin-left: auto;
                margin-right: auto;
            }

            /* styling for button div*/
            .container {
                height: 200px;
                position: relative;
            }

            /* Styling for images of queries above buttons (General and Visual queries)*/
            .center {
                margin: 0;
                position: absolute;
                top: 50%;
                left: 50%;
                -ms-transform: translate(-50%, -50%);
                transform: translate(-50%, -50%);
            }
            /* button styling */
            .button {
                border: none;
                color: white;
                padding: 15px 32px;
                text-align: center;
                text-decoration: none;
                display: inline-block;
                font-size: 16px;
                margin: 15px;
                cursor: pointer;
            }
            .button1 {background-color: #6a0dad;} /* purple */
            .button2 {background-color: #008CBA;} /* Blue */
        </style>
    </head>
    <body>
        <!-- START -- Add HTML code for the top menu section (navigation bar) -->
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark">
            <style>
                /* Add Local Pokemon Fonts */

                /* https://www.fontspace.com/pocket-monk-font-f23540 */
                @font-face {
                    font-family: "PocketMonk";
                    src: url("/groupAssignment/fonts/PocketMonk-15ze.ttf");
                }
                /* https://www.fontspace.com/eviolite-font-f32546 */
                @font-face {
                    font-family: "EvioliteRegular";
                    src: url("/groupAssignment/fonts/EvioliteRegular-ZjA8.ttf");
                }
                /* This one doesn't seem to work*/
                @font-face {
                    font-family: "LMSPokedex";
                    src: url("/groupAssignment/fonts/LmsPokedex-XEja.ttf");
                }
                /* https://www.fontspace.com/pokemon-gb-font-f9621 */
                @font-face {
                    font-family: "PokemonGB";
                    src: url("/groupAssignment/fonts/PokemonGb-RAeo.ttf");
                }
                /* https://www.fontspace.com/pokemon-hollow-font-f13845 */
                @font-face {
                    font-family: "PokemonHollow";
                    src: url("/groupAssignment/fonts/PokemonHollowNormal-pyPZ.ttf");
                }
                /* https://www.fontspace.com/pokemon-solid-font-f13844 */
                @font-face {
                    font-family: "PokemonSolid";
                    src: url("/groupAssignment/fonts/PokemonSolidNormal-xyWR.ttf");
                }
                /* https://www.fontspace.com/pokemon-solid-font-f13844 */
                @font-face {
                    font-family: "Hisel";
                    src: url("/groupAssignment/fonts/HiselRegular-9qyj.ttf");
                }
                
                /* NavBar "KantoSpirit" font*/
                .navbar-brand {
                    font-family: PocketMonk;
                }
                /* NavBar Page Selection Header Font (Home, Spirit Pokemon Queries,...,About)*/
                .nav-item {
                    font-family: Hisel;
                    font-size: 180%;
                }

                /* styling for button div*/
                .container {
                    font-family: Hisel;
                    font-size: 200%;
                }
                /* submit button margins */
                .btnSubmit {
                    margin: 25px;
                }

            </style>
            <a class="navbar-brand" href="#">Kanto Spirit</a>
            <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarColor02" aria-
                    controls="navbarColor02" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarColor02">
                <ul class="navbar-nav mr-auto">
                    <li class="nav-item">
                        <a class="nav-link" href="index.php">Home
                            <span class="sr-only">(current)</span>
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="SpiritPokemonQueries.php">Spirit Pokemon Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link active" href="GeneralQueries.php">General Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="VisualQueries.php">Visual Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="About.php">About</a>
                    </li>
                </ul>
            </div>
        </nav>
        <!-- Not sure how to space out the buttons -->
        <!--<div class="jumbotron">-->
        <div class="center">
            <div class="row">
             <div class="column">
                  <img src="/groupAssignment/images/SearchR.png" alt="Logo" class = "column">
             </div>
              <div class="column">
                  <img src="/groupAssignment/images/SearchN.png" alt="Logo" class = "column">
                </div>
            </div>
            <div class="container">
                <div class="center">
                    <a href="Region.html">
                        <button class="button button1">Search</button>
                    <a href="Number.html">
                        <button class="button button1">Search</button>

                </div>
            </div>
        </div>
    </body>
    <style>
        .button {
            border:0;
            outline: 0;
        }

    </style>
</html>