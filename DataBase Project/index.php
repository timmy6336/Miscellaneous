<?php
/*
Name: Gregory Hablutzel, Timmy Roma, Ella Gainey
Class: TCSS445-DB Fall-20 Al-Masri
Assignment: Group Assignment Phase 3
Description:
 - This PHP file contains the HomePage php for Kanto Spirit.
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
            </style>
            <a class="navbar-brand" href="#">Kanto Spirit</a>
            <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarColor02" aria-
                    controls="navbarColor02" aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
            </button>
            <div class="collapse navbar-collapse" id="navbarColor02">
                <ul class="navbar-nav mr-auto">
                    <li class="nav-item">
                        <a class="nav-link active" href="index.php">Home
                            <span class="sr-only">(current)</span>
                        </a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="SpiritPokemonQueries.php">Spirit Pokemon Queries</a>
                    </li>
                    <li class="nav-item">
                        <a class="nav-link" href="GeneralQueries.php">General Queries</a>
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
        <!-- END -- Add HTML code for the top menu section (navigation bar) -->
        <div class="jumbotron">
            <img src="/groupAssignment/images/KantoSpirit2.png" alt="Logo" class = style="width:50%;">
            <h1>Enhance  the  way  you  search  for  Pokemon  with  Kanto  Spirit</h1>
            <h3>Gregory   Habutzel,  Ella  Gainey , and  Timmy  Roma</h3>
        </div>
        <style>
            /* h1 styling */
            .jumbotron h1 {
                font-family: Hisel;
                text-align:center
            }
            /* h3 styling */
            .jumbotron h3 {
                font-family: Hisel;
                text-align:center
            }
        </style>
    </body>
    <h6>greghab@uw.edu, audreyeg@uw.edu, timmy6336@gmail.com </h6>
    <style>
        /* h6 styling */
        .jumbotron h6 {
            font-family: Hisel;
            text-align:center
        }
    </style>
</html>